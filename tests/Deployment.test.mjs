import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distributionRoot = path.resolve(process.env.BLACKPY_DISTRIBUTION ||
    path.join(toolRoot, "artifacts", "blackpy"));
const practice = path.join(distributionRoot, "실습");
const reportPath = path.join(toolRoot, "artifacts", "test-results", "deployment-verification.json");
const pwsh = process.env.POWERSHELL_EXE || "pwsh";
const report = {
    passed: false, checks: [], limits: ["Tested on a development machine, not a clean SDK-free machine."]
};
const sourceConfig = await readFile(path.join(practice, "project.json"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
let launcher;
let hostPid;
let socket;
let address;
let token;
let state;
let copiedRuntime;
let hostOutput = "";

async function run(executable, args, options = {}) {
    return await new Promise((resolve, reject) => {
        const child = spawn(executable, args, { windowsHide: true, ...options });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (data) => { stdout += data.toString(); });
        child.stderr.on("data", (data) => { stderr += data.toString(); });
        child.once("error", reject);
        child.once("exit", (code) => resolve({ code, stdout, stderr }));
    });
}

async function powershell(script, environment = process.env) {
    const utf8Script = "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); " + script;
    const encoded = Buffer.from(utf8Script, "utf16le").toString("base64");
    const result = await run(pwsh, ["-NoLogo", "-NoProfile", "-EncodedCommand", encoded], { env: environment });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    return result.stdout.trim();
}

async function waitFor(predicate, message, timeout = 15000) {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 30));
    }

    throw new Error(message + "; " + hostOutput);
}

async function request(endpoint) {
    const response = await fetch(address + endpoint, {
        method: endpoint === "/api/state" ? "GET" : "POST",
        headers: { "X-Playground-Token": token },
        signal: AbortSignal.timeout(10000)
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
}

function psLiteral(value) {
    return "'" + value.replaceAll("'", "''") + "'";
}

try {
    const workspace = await mkdtemp(path.join(tmpdir(), "BlackPy 배포 확인 "));
    const copiedPractice = path.join(workspace, "한글과 공백 실습");
    const otherCwd = path.join(workspace, "다른 작업 폴더");
    const emptyDotnet = path.join(workspace, "빈 닷넷 폴더");
    report.workspace = workspace;
    await mkdir(otherCwd);
    await mkdir(emptyDotnet);
    await cp(practice, copiedPractice, { recursive: true });
    copiedRuntime = path.join(copiedPractice, "시작.exe");
    assert.equal(digest(await readFile(path.join(copiedPractice, "project.json"))), digest(sourceConfig));
    assert.ok((await readFile(path.join(copiedPractice, "_runtime", "Box2D.NET.dll"))).length > 0);
    assert.deepEqual(await readFile(path.join(copiedPractice, "_runtime", "licenses", "Box2D.NET.LICENSE.md")),
        await readFile(path.join(toolRoot, "packages", "Box2D.NET.LICENSE.md")));
    report.checks.push("Box2D.NET assembly and pinned MIT notice are included in the folder distribution");

    const python = await run(process.env.PYTHON_EXE || "python", ["-c", "import sys; print(sys.executable)"]);
    assert.equal(python.code, 0, python.stderr);
    const pythonExecutable = python.stdout.trim();
    const windowsRoot = process.env.SystemRoot || "C:\\Windows";
    const environment = Object.fromEntries(Object.entries(process.env)
        .filter(([name]) => name.toLowerCase() !== "path" && !name.toUpperCase().startsWith("DOTNET_ROOT")));
    Object.assign(environment, {
        PATH: [path.join(windowsRoot, "System32"), windowsRoot, path.dirname(pythonExecutable)].join(path.delimiter),
        PYTHON_EXE: pythonExecutable,
        DOTNET_ROOT: emptyDotnet,
        DOTNET_ROOT_X64: emptyDotnet,
        DOTNET_ROOT_X86: emptyDotnet,
        DOTNET_MULTILEVEL_LOOKUP: "0"
    });

    const lookup = await run(path.join(windowsRoot, "System32", "where.exe"), ["dotnet"], {
        cwd: otherCwd, env: environment
    });
    assert.notEqual(lookup.code, 0, "dotnet must not be discoverable through the test PATH");
    report.checks.push("dotnet absent from child PATH; DOTNET_ROOT variants point to an empty directory");

    const binary = await readFile(copiedRuntime);
    const peOffset = binary.readUInt32LE(0x3c);
    assert.equal(binary.readUInt16LE(peOffset + 24 + 68), 2, "Launcher must use the Windows GUI subsystem");
    launcher = spawn(copiedRuntime, ["--no-browser"], {
        cwd: otherCwd, env: environment, windowsHide: false
    });
    launcher.on("error", (error) => { hostOutput += String(error); });
    launcher.stdout.on("data", (data) => {
        hostOutput += data.toString();
        const match = hostOutput.match(/PLAYGROUND_URL=(http:\/\/[^\s]+)/);

        if (match) {
            const url = new URL(match[1]);
            address = url.origin;
            token = new URLSearchParams(url.hash.slice(1)).get("token");
        }
    });
    launcher.stderr.on("data", (data) => { hostOutput += data.toString(); });
    await waitFor(() => address, "Copied GUI launcher did not announce PLAYGROUND_URL");
    report.address = address;
    report.checks.push("Unmodified Windows GUI launcher started from a different cwd in a Korean-and-space TEMP path");
    console.log("DEPLOYMENT_BROWSER_ADDRESS=" + address);

    const runtimeInfo = JSON.parse(await powershell(
        "$p = @(Get-CimInstance Win32_Process -Filter \"Name='시작.exe'\" | " +
        "Where-Object { $_.ExecutablePath -eq " + psLiteral(copiedRuntime) + " }); " +
        "if ($p.Count -ne 1) { throw 'Expected exactly one copied host process' }; " +
        "$clr = (Get-Process -Id $p[0].ProcessId).Modules | Where-Object ModuleName -eq 'coreclr.dll'; " +
        "[pscustomobject]@{ pid=$p[0].ProcessId; parentPid=$p[0].ParentProcessId; " +
        "coreclr=$clr.FileName } | ConvertTo-Json"
    ));
    hostPid = runtimeInfo.pid;
    assert.equal(runtimeInfo.pid, launcher.pid);
    assert.equal(runtimeInfo.parentPid, process.pid);
    assert.equal(runtimeInfo.coreclr.toLowerCase(),
        path.join(copiedPractice, "_runtime", "coreclr.dll").toLowerCase());
    report.runtime = runtimeInfo;
    report.checks.push("Running host loaded coreclr.dll from the copied self-contained _runtime directory");

    const page = await fetch(address, { signal: AbortSignal.timeout(10000) });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<canvas/);
    socket = new WebSocket(address.replace("http:", "ws:") + "/ws?token=" + token);
    socket.addEventListener("message", ({ data }) => { state = { ...state, ...JSON.parse(data) }; });
    await waitFor(() => state?.type === "snapshot", "WebSocket snapshot missing");
    report.checks.push("Copied runtime served the web canvas and sent an authenticated WebSocket snapshot");

    await request("/api/run");
    await waitFor(() => state?.scene?.sprites?.length === 2 && state.scene.message.length > 0,
        "Default project did not initialize");
    const initial = await request("/api/state");
    assert.equal(initial.status, "running", JSON.stringify(initial));
    assert.deepEqual(initial.scene.sprites.map(sprite => sprite.label), ["고양이", "자동차"]);
    report.checks.push("Unmodified background and two actor files initialized and awaited input");

    await writeFile(path.join(copiedPractice, "고양이.py"),
        'def 시작():\n    위치 = (0, 0)\n    앞으로(37)\n    print("저장한 코드 실행 확인")\n', "utf8");
    const previousRun = initial.runId;
    await request("/api/restart");
    await waitFor(() => state?.runId !== previousRun &&
        state.output?.some(line => line.text === "저장한 코드 실행 확인"), "Saved code did not execute");
    const saved = await request("/api/state");
    const cat = saved.scene.sprites.find(sprite => sprite.label === "고양이");
    assert.ok(Math.abs(cat.x - 37) < 0.01 && Math.abs(cat.y) < 0.01, JSON.stringify(saved));
    report.checks.push("Saving the actor script changed the next run while preserving other actors");
    await request("/api/stop");
    socket.close();
    await waitFor(() => launcher.exitCode !== null, "Closing the web page did not exit the GUI launcher");
    assert.equal(launcher.exitCode, 0, hostOutput);
    report.checks.push("Closing the final web connection automatically exited the GUI launcher");

    const publishDestination = path.join(workspace, "반복 배포 보존 확인");
    const preserved = path.join(publishDestination, "실습");
    await cp(path.join(toolRoot, "distribution", "project"), preserved, { recursive: true });
    const sentinel = Buffer.from('# 학생이 저장한 내용\ndef 시작():\n    print("보존 확인 123")\n', "utf8");
    await writeFile(path.join(preserved, "고양이.py"), sentinel);
    const configuration = JSON.parse(await readFile(path.join(preserved, "project.json"), "utf8"));
    configuration.actors[0].speed = 3;
    await writeFile(path.join(preserved, "project.json"), JSON.stringify(configuration));
    const filenames = ["project.json", "고양이.py", "자동차.py", "배경.py"];
    const originalHashes = await Promise.all(filenames.map(async file => digest(await readFile(path.join(preserved, file)))));
    for (let i = 0; i < 2; i++) {
        const published = await run(pwsh, ["-NoLogo", "-NoProfile", "-File",
            path.join(toolRoot, "scripts", "Publish.ps1"), "-Destination", publishDestination, "-SkipRestore"], {
            cwd: otherCwd
        });
        assert.equal(published.code, 0, published.stderr + published.stdout);
        assert.match(published.stdout, /BLACKPY_PUBLISHED=/);
        const hashes = await Promise.all(filenames.map(async file => digest(await readFile(path.join(preserved, file)))));
        assert.deepEqual(hashes, originalHashes);
    }
    report.checks.push("Two publications preserved all existing actor scripts and project settings byte-for-byte");

    const legacy = path.join(workspace, "이전 프로젝트");
    await mkdir(path.join(legacy, "실습"), { recursive: true });
    const legacyFile = path.join(legacy, "실습", "main.py");
    await writeFile(legacyFile, sentinel);
    const rejected = await run(pwsh, ["-NoLogo", "-NoProfile", "-File",
        path.join(toolRoot, "scripts", "Publish.ps1"), "-Destination", legacy, "-SkipRestore"]);
    assert.notEqual(rejected.code, 0);
    assert.equal(digest(await readFile(legacyFile)), digest(sentinel));
    report.checks.push("Legacy main.py projects are rejected before publication and remain unchanged");
    report.passed = true;
} catch (error) {
    report.failure = String(error.stack || error);
    process.exitCode = 1;
} finally {
    if (address) {
        try { await request("/api/stop"); } catch { /* The test host may already have exited. */ }
    }

    socket?.close();

    if (copiedRuntime) {
        try {
            await powershell(
                "$targets = @(Get-CimInstance Win32_Process -Filter \"Name='시작.exe'\" | " +
                "Where-Object { $_.ExecutablePath -eq " + psLiteral(copiedRuntime) + " }); " +
                "$targets | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }; " +
                "'HOSTS_STOPPED=' + $targets.Count"
            );
            report.hostStopped = true;
        } catch (error) {
            report.cleanupError = String(error);
            report.passed = false;
            process.exitCode = 1;
        }
    }

    if (launcher && launcher.exitCode === null && launcher.signalCode === null) launcher.kill();
    report.distributionConfigUnchanged = digest(await readFile(path.join(practice, "project.json"))) === digest(sourceConfig);

    if (!report.distributionConfigUnchanged) {
        report.passed = false;
        process.exitCode = 1;
    }

    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
}
