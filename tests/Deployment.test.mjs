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
const cmd = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
const report = {
    passed: false, checks: [], limits: ["Tested on a development machine, not a clean SDK-free machine."]
};
const sourceMain = await readFile(path.join(practice, "main.py"));
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
    copiedRuntime = path.join(copiedPractice, "_runtime", "BlackThunder.BlackPy.exe");
    assert.equal(digest(await readFile(path.join(copiedPractice, "main.py"))), digest(sourceMain));

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

    const batch = path.join(copiedPractice, "시작.bat");
    launcher = spawn(cmd, ["/d", "/s", "/c", '""' + batch + '""'], {
        cwd: otherCwd, env: environment, windowsHide: true, windowsVerbatimArguments: true
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
    await waitFor(() => address, "Copied BAT did not announce PLAYGROUND_URL");
    report.address = address;
    report.checks.push("Unmodified copied BAT launched from a different cwd in a Korean-and-space TEMP path");
    console.log("DEPLOYMENT_BROWSER_ADDRESS=" + address);

    const runtimeInfo = JSON.parse(await powershell(
        "$p = @(Get-CimInstance Win32_Process -Filter \"Name='BlackThunder.BlackPy.exe'\" | " +
        "Where-Object { $_.ExecutablePath -eq " + psLiteral(copiedRuntime) + " }); " +
        "if ($p.Count -ne 1) { throw 'Expected exactly one copied host process' }; " +
        "$clr = (Get-Process -Id $p[0].ProcessId).Modules | Where-Object ModuleName -eq 'coreclr.dll'; " +
        "[pscustomobject]@{ pid=$p[0].ProcessId; parentPid=$p[0].ParentProcessId; " +
        "coreclr=$clr.FileName } | ConvertTo-Json"
    ));
    hostPid = runtimeInfo.pid;
    assert.equal(runtimeInfo.parentPid, launcher.pid);
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
    await waitFor(() => state?.status === "completed" || state?.status === "error", "Default code did not finish");
    const initial = await request("/api/state");
    assert.equal(initial.status, "completed", JSON.stringify(initial));
    assert.ok(Math.abs(initial.x) < 0.01 && Math.abs(initial.y) < 0.01);
    assert.match(initial.output.map((line) => line.text).join("\n"), /완료!/);
    report.checks.push("Unmodified deployed main.py completed its square and printed Korean output");

    await writeFile(path.join(copiedPractice, "main.py"),
        'from playground import cat\ncat.forward(37)\nprint("저장한 코드 실행 확인")\n', "utf8");
    const previousRun = initial.runId;
    await request("/api/restart");
    await waitFor(() => state?.runId !== previousRun && state?.status === "completed", "Saved code did not finish");
    const saved = await request("/api/state");
    assert.ok(Math.abs(saved.x - 37) < 0.01 && Math.abs(saved.y) < 0.01, JSON.stringify(saved));
    assert.match(saved.output.map((line) => line.text).join("\n"), /저장한 코드 실행 확인/);
    report.checks.push("Saving main.py in the copied project changed the next run to forward(37)");
    await request("/api/stop");
    socket.close();

    const publishDestination = path.join(workspace, "반복 배포 보존 확인");
    await mkdir(path.join(publishDestination, "실습"), { recursive: true });
    const sentinel = Buffer.from('# 학생이 저장한 내용\nprint("보존 확인 123")\n', "utf8");
    const sentinelPath = path.join(publishDestination, "실습", "main.py");
    await writeFile(sentinelPath, sentinel);

    for (let i = 0; i < 2; i++) {
        const published = await run(pwsh, ["-NoLogo", "-NoProfile", "-File",
            path.join(toolRoot, "scripts", "Publish.ps1"), "-Destination", publishDestination, "-SkipRestore"], {
            cwd: otherCwd
        });
        assert.equal(published.code, 0, published.stderr + published.stdout);
        assert.match(published.stdout, /BLACKPY_PUBLISHED=/);
        assert.equal(digest(await readFile(sentinelPath)), digest(sentinel));
    }

    report.checks.push(
        "Two Publish.ps1 -SkipRestore runs preserved an existing main.py byte-for-byte in a separate TEMP target");
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
                "$targets = @(Get-CimInstance Win32_Process -Filter \"Name='BlackThunder.BlackPy.exe'\" | " +
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
    report.distributionMainUnchanged = digest(await readFile(path.join(practice, "main.py"))) === digest(sourceMain);

    if (!report.distributionMainUnchanged) {
        report.passed = false;
        process.exitCode = 1;
    }

    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
}
