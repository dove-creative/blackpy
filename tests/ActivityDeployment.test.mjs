import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { access, cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distributionRoot = path.resolve(process.env.BLACKPY_DISTRIBUTION ||
    path.join(toolRoot, "artifacts", "blackpy"));
const reportPath = path.join(toolRoot, "artifacts", "test-results", "activity-deployment.json");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const names = (await readdir(path.join(toolRoot, "examples"))).sort();
const original = new Map();
for (const name of ["실습", ...names]) {
    original.set(name, digest(await readFile(path.join(distributionRoot, name, "main.py"))));
}
const report = { passed: false, checks: [], limits: ["Development PC; no separate SDK-free PC tested."] };

async function run(command, args, options = {}) {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    const [code] = await once(child, "exit");
    assert.equal(code, 0, output);
    return output;
}

async function waitFor(predicate, timeout = 16000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Activity timed out");
}

try {
    assert.equal(names.length, 5);
    const workspace = await mkdtemp(path.join(tmpdir(), "BlackPy 다섯 놀이 "));
    const copied = path.join(workspace, "복사한 BlackPy 배포 폴더");
    const otherCwd = path.join(workspace, "다른 작업 위치");
    await mkdir(otherCwd);
    await cp(distributionRoot, copied, { recursive: true });
    report.workspace = workspace;
    const cmd = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
    const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");

    for (const name of names) {
        await assert.rejects(access(path.join(copied, "실습", name)), { code: "ENOENT" });
        const batch = path.join(copied, name, "시작.bat");
        const batchText = await readFile(batch, "utf8");
        assert.notEqual(batchText.charCodeAt(0), 0xfeff, "Activity BAT must not have a UTF-8 BOM");
        assert.doesNotMatch(batchText, /(?<!\r)\n/, "UTF-8 activity BAT requires CRLF for cmd.exe");
        const child = spawn(cmd, ["/d", "/s", "/c", '""' + batch + '" --no-browser"'], {
            cwd: otherCwd, windowsHide: true, windowsVerbatimArguments: true
        });
        let output = "";
        let socket;
        let state;
        child.stdout.on("data", (data) => { output += data; });
        child.stderr.on("data", (data) => { output += data; });
        try {
            try {
                await waitFor(() => /PLAYGROUND_URL=http:\/\/\S+/.test(output));
            } catch (error) {
                throw new Error(`Activity BAT failed to start: ${name}; ${output}`, { cause: error });
            }
            const url = new URL(output.match(/PLAYGROUND_URL=(http:\/\/\S+)/)[1]);
            const token = new URLSearchParams(url.hash.slice(1)).get("token");
            async function request(endpoint) {
                const response = await fetch(url.origin + endpoint, {
                    method: endpoint === "/api/state" ? "GET" : "POST",
                    headers: { "X-Playground-Token": token },
                    signal: AbortSignal.timeout(10000)
                });
                assert.equal(response.status, 200);
                return await response.json();
            }
            socket = new WebSocket(url.origin.replace("http:", "ws:") + "/ws?token=" + token);
            socket.addEventListener("message", ({ data }) => { state = { ...state, ...JSON.parse(data) }; });
            await waitFor(() => state);
            await request("/api/run");
            await waitFor(() => ["completed", "error"].includes(state.status));
            assert.equal(state.status, "completed", JSON.stringify(state));
            assert.equal(state.scene.active, true);
            report.checks.push(`${name}: unit-folder BAT ran saved Python from a different working directory`);

            if (name.startsWith("1.")) {
                const main = path.join(copied, name, "main.py");
                const changed = (await readFile(main, "utf8")).replace("car.forward(420)", "car.forward(210)");
                await writeFile(main, changed, "utf8");
                const previous = state.runId;
                await request("/api/restart");
                await waitFor(() => state.runId !== previous && state.status === "completed");
                assert.ok(Math.abs(state.scene.sprites[0].x + 50) < 0.001);
                report.checks.push("Saved car distance 420 -> 210 was applied on restart (x=-50)");
            }
            await request("/api/stop");
        } finally {
            socket?.close();
            if (child.exitCode === null && child.signalCode === null) {
                await run(taskkill, ["/PID", String(child.pid), "/T", "/F"]);
            }
        }
    }

    const preserved = new Map();
    for (const name of ["실습", ...names]) {
        const main = path.join(copied, name, "main.py");
        const text = await readFile(main, "utf8") + "\n# 학생이 저장한 수정 내용\n";
        await writeFile(main, text, "utf8");
        preserved.set(name, digest(Buffer.from(text)));
    }
    for (let i = 0; i < 2; i++) {
        await run(process.env.POWERSHELL_EXE || "pwsh", ["-NoProfile", "-File",
            path.join(toolRoot, "scripts", "Publish.ps1"), "-Destination", copied, "-SkipRestore"], { cwd: otherCwd });
        for (const [name, hash] of preserved) {
            assert.equal(digest(await readFile(path.join(copied, name, "main.py"))), hash);
        }
    }
    report.checks.push("Two publishes preserved basic practice and all five edited main.py files byte-for-byte");
    const moduleHash = digest(await readFile(path.join(toolRoot, "distribution", "blackpy.py")));
    for (const name of names) {
        assert.equal(digest(await readFile(path.join(copied, name, "blackpy.py"))), moduleHash);
        await assert.rejects(access(path.join(copied, "실습", name)), { code: "ENOENT" });
    }
    report.checks.push("All five support modules match the current source after republishing");
    report.checks.push("Republishing creates no old activity folders under the shared practice directory");
    report.passed = true;
} catch (error) {
    report.failure = String(error.stack || error);
    process.exitCode = 1;
} finally {
    for (const [name, hash] of original) {
        if (digest(await readFile(path.join(distributionRoot, name, "main.py"))) !== hash) {
            report.passed = false;
            report.distributionChanged = name;
            process.exitCode = 1;
        }
    }
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
}
