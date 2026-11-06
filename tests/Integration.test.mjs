import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distributionRoot = path.resolve(globalThis.process.env.BLACKPY_DISTRIBUTION ||
    path.join(toolRoot, "artifacts", "blackpy"));
const practice = path.join(distributionRoot, "실습");
const executable = path.join(practice, "_runtime", "BlackThunder.BlackPy.exe");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let workspace;
let process;
let address;
let token;
let socket;
let state;
let processOutput = "";
let sceneHistory = [];

async function waitFor(predicate, message, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await pause(20);
    }
    throw new Error(`${message}; state=${JSON.stringify(state)}; host=${processOutput}`);
}

async function connect() {
    const next = new WebSocket(`${address.replace("http:", "ws:")}/ws?token=${token}`);
    let receivedSnapshot = false;
    next.addEventListener("message", ({ data }) => {
        const message = JSON.parse(data);
        state = { ...state, ...message };
        if (message.scene?.active) {
            sceneHistory.push(message.scene);
            if (sceneHistory.length > 500) sceneHistory.shift();
        }
        if (message.type === "snapshot") receivedSnapshot = true;
    });
    await once(next, "open");
    await waitFor(() => receivedSnapshot, "New browser did not receive its own snapshot");
    return next;
}

async function request(endpoint, data, credential = token) {
    const response = await fetch(`${address}${endpoint}`, {
        method: endpoint === "/api/state" ? "GET" : "POST",
        headers: { "Content-Type": "application/json", "X-Playground-Token": credential },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: AbortSignal.timeout(15000)
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function code(source) {
    await writeFile(path.join(workspace, "main.py"), source, "utf8");
}

async function complete(source, action = "/api/run", timeout = 8000) {
    await code(source);
    const previous = state?.runId;
    const response = await request(action);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    await waitFor(() => state?.runId !== previous &&
        ["completed", "error"].includes(state.status), "Python did not finish", timeout);
    const snapshot = await request("/api/state");
    state = { ...state, ...snapshot.body };
    return state;
}

function outputText() {
    return (state.output ?? []).map((line) => line.text).join("\n");
}

function processExists(pid) {
    try {
        globalThis.process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error.code === "ESRCH") return false;
        throw error;
    }
}

async function terminate(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
}

function environmentWithPath(searchPath, overrides = {}) {
    const environment = Object.fromEntries(Object.entries(globalThis.process.env)
        .filter(([name]) => name.toLowerCase() !== "path"));
    return { ...environment, PATH: searchPath, ...overrides };
}

before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "BlackPy 한글 공백 "));
    await copyFile(path.join(toolRoot, "distribution", "playground.py"), path.join(workspace, "playground.py"));
    await copyFile(path.join(toolRoot, "distribution", "blackpy.py"), path.join(workspace, "blackpy.py"));
    process = spawn(executable, ["--project", workspace, "--no-browser"], {
        cwd: tmpdir(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"]
    });
    process.on("error", (error) => { processOutput += String(error); });
    process.stdout.on("data", (data) => {
        processOutput += data.toString();
        const match = processOutput.match(/PLAYGROUND_URL=(http:\/\/[^\s]+)/);
        if (match) {
            const url = new URL(match[1]);
            address = url.origin;
            token = new URLSearchParams(url.hash.slice(1)).get("token");
        }
    });
    process.stderr.on("data", (data) => { processOutput += data.toString(); });
    await waitFor(() => address, "Host did not start", 15000);
    socket = await connect();
    await waitFor(() => state, "Initial snapshot missing");
});

after(async () => {
    if (address) {
        try { await request("/api/stop"); } catch { /* Host may have exited. */ }
    }
    socket?.close();
    await terminate(process);
    const evidence = path.join(toolRoot, "artifacts", "test-results");
    await mkdir(evidence, { recursive: true });
    await writeFile(path.join(evidence, "integration-workspace.txt"), workspace ?? "not-created");
});

test("loopback API requires the connection token", async () => {
    assert.equal((await request("/api/state", undefined, "wrong")).status, 401);
});

test("missing main.py gives a useful error and never creates the file", async () => {
    const response = await request("/api/run");
    assert.notEqual(response.status, 200);
    assert.match(response.body.error, /main\.py/);
});

test("moves finish before the next Python line and Korean stdout is retained", async () => {
    await code('from playground import cat\ncat.forward(100)\nprint("이동 완료! 🐱")\n' +
        'cat.left(180)\nprint("회전 완료!")\n');
    const previous = state.runId;
    const started = Date.now();
    assert.equal((await request("/api/run")).status, 200);
    await waitFor(() => state.runId !== previous && outputText().includes("이동 완료! 🐱"),
        "Movement completion output was not received");
    assert.equal(state.status, "running", "The following rotation must still be running");
    assert.ok(Math.abs(state.x - 100) < 0.001, "print appeared before movement reached its destination");
    assert.ok(Date.now() - started >= 450);
    assert.doesNotMatch(outputText(), /회전 완료/);
    await waitFor(() => state.status === "completed", "Rotation did not finish");
    assert.equal(state.status, "completed");
    assert.ok(Math.abs(state.x - 100) < 0.001);
    assert.ok(Math.abs(state.heading - 180) < 0.001);
    assert.match(outputText(), /회전 완료!/);
});

test("saved edits are used on restart, and goto preserves the current heading", async () => {
    await complete("from playground import cat\ncat.left(90)\ncat.goto(-30, 25)\n", "/api/restart");
    assert.equal(state.status, "completed");
    assert.ok(Math.abs(state.x + 30) < 0.001 && Math.abs(state.y - 25) < 0.001);
    assert.ok(Math.abs(state.heading - 90) < 0.001);
});

test("signed and zero distances, full turns and square return to their start", async () => {
    await complete("from playground import cat\ncat.forward(0)\ncat.forward(-10)\ncat.backward(-10)\n" +
        "cat.right(360)\nfor i in range(4):\n    cat.forward(10)\n    cat.left(90)\n");
    assert.equal(state.status, "completed");
    assert.ok(Math.abs(state.x) < 0.001 && Math.abs(state.y) < 0.001);
    assert.ok(Math.abs(state.heading) < 0.001 || Math.abs(state.heading - 360) < 0.001);
});

test("concurrent starts accept one process and reject the duplicate", async () => {
    await code("while True:\n    pass\n");
    const results = await Promise.all([request("/api/run"), request("/api/run")]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    assert.equal((await request("/api/stop")).status, 200);
    await waitFor(() => state.status === "stopped", "Infinite loop did not stop");
});

test("stop and direct moving restart reject the previous run while the new run is active", async () => {
    await code('from playground import cat\nprint("OLD RUN")\ncat.forward(100000)\n');
    assert.equal((await request("/api/run")).status, 200);
    await waitFor(() => state.status === "running" && state.x > 10, "Movement did not begin");
    const stoppedRun = state.runId;
    assert.equal((await request("/api/stop")).status, 200);
    await waitFor(() => state.status === "stopped", "Movement did not stop");
    const stoppedX = state.x;
    await pause(150);
    assert.equal(state.x, stoppedX);

    assert.equal((await request("/api/run")).status, 200);
    await waitFor(() => state.runId !== stoppedRun && state.status === "running" && state.x > 10,
        "The next long movement did not begin");
    const oldRun = state.runId;
    await code('from playground import cat\ncat.forward(12)\nprint("NEW RUN")\nwhile True:\n    pass\n');
    assert.equal((await request("/api/restart")).status, 200);
    await waitFor(() => state.runId !== oldRun && state.status === "running" && outputText().includes("NEW RUN"),
        "Restart did not load the saved replacement code");
    assert.ok(Math.abs(state.x - 12) < 0.001);
    assert.doesNotMatch(outputText(), /OLD RUN/);
    assert.equal((await request("/api/command", { runId: oldRun, command: "forward", args: [50] })).status, 409);
    assert.ok(Math.abs((await request("/api/state")).body.x - 12) < 0.001);
    assert.equal((await request("/api/stop")).status, 200);
});

test("syntax and runtime errors show the student's filename and traceback", async () => {
    await complete("if True\n    pass\n");
    assert.equal(state.status, "error");
    assert.match(outputText(), /main\.py/);
    assert.match(outputText(), /SyntaxError/);
    await complete('raise ValueError("연습 오류")\n');
    assert.equal(state.status, "error");
    assert.match(outputText(), /연습 오류/);
});

test("input fails promptly instead of waiting, and nonfinite arguments are refused", async () => {
    await complete('input("입력: ")\n');
    assert.equal(state.status, "error");
    assert.match(outputText(), /EOFError/);
    await complete('from playground import cat\ncat.forward(float("nan"))\n');
    assert.equal(state.status, "error");
    assert.match(outputText(), /유한한 숫자/);
});

test("stdout and stderr drain without deadlock and only the latest 1000 lines remain", async () => {
    await complete('import sys\nfor i in range(1200):\n' +
        '    print(f"OUT:{i}:" + "o" * 80)\n' +
        '    print(f"ERR:{i}:" + "e" * 80, file=sys.stderr)\n' +
        'print("STDOUT_DONE")\nprint("STDERR_DONE", file=sys.stderr)\n', "/api/run", 20000);
    assert.equal(state.status, "completed");
    assert.equal(state.output.length, 1000);
    assert.ok(state.output.some((line) => line.stream === "stdout" && line.text === "STDOUT_DONE"));
    assert.ok(state.output.some((line) => line.stream === "stderr" && line.text === "STDERR_DONE"));
    assert.match(outputText(), /OUT:1199:/);
    assert.match(outputText(), /ERR:1199:/);
    assert.doesNotMatch(outputText(), /(?:OUT|ERR):0:/);
});

test("continuous output without newlines remains stoppable", async () => {
    await code('import sys\nwhile True:\n    sys.stdout.write("x" * 1000)\n');
    assert.equal((await request("/api/run")).status, 200);
    await pause(250);
    assert.equal((await request("/api/stop")).status, 200);
    await waitFor(() => state.status === "stopped", "No-newline output could not be stopped");
    const snapshot = (await request("/api/state")).body;
    assert.ok(snapshot.output.length <= 1000);
    assert.ok(snapshot.output.every((line) => line.text.length <= 8192));
});

test("only the last browser disconnect stops execution and reconnect restores position, run and output", async () => {
    await code('from playground import cat\ncat.goto(75, -25)\nprint("재접속 전 출력")\nwhile True:\n    pass\n');
    assert.equal((await request("/api/run")).status, 200);
    await waitFor(() => state.status === "running" && outputText().includes("재접속 전 출력"),
        "Run did not reach the retained position");
    const second = await connect();
    const closed = once(socket, "close");
    socket.close();
    await closed;
    socket = second;
    await pause(300);
    assert.equal((await request("/api/state")).body.status, "running",
        "Closing one of two browsers must not stop the run");
    const lastClosed = once(socket, "close");
    socket.close();
    await lastClosed;
    await waitFor(async () => (await request("/api/state")).body.status === "stopped",
        "Closing the last browser did not stop the run");
    assert.equal((await request("/api/stop")).status, 200);
    const retained = (await request("/api/state")).body;
    state = undefined;
    socket = await connect();
    assert.equal(state.type, "snapshot");
    assert.equal(state.status, "stopped");
    assert.equal(state.runId, retained.runId);
    assert.equal(state.x, retained.x);
    assert.equal(state.y, retained.y);
    assert.equal(state.heading, retained.heading);
    assert.deepEqual(state.output, retained.output);
    assert.ok(Math.abs(state.x - 75) < 0.001 && Math.abs(state.y + 25) < 0.001);
    assert.match(outputText(), /재접속 전 출력/);
    await complete('print("재접속 완료")\n');
    assert.equal(state.status, "completed");
});

test("a child left behind by an exited student Python is terminated and does not hold output pipes open", async () => {
    let childPid;
    try {
        await code('import subprocess, sys\n' +
            'child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])\n' +
            'print(f"CHILD_PID={child.pid}", flush=True)\n');
        const previous = state.runId;
        assert.equal((await request("/api/run")).status, 200);
        await waitFor(() => state.runId !== previous && /CHILD_PID=\d+/.test(outputText()), "Child PID missing");
        childPid = Number(outputText().match(/CHILD_PID=(\d+)/)[1]);
        await waitFor(() => state.status === "completed", "Exited parent left inherited output pipes open");
        await waitFor(() => !processExists(childPid), "Exited parent's child is still alive");
        await complete('print("자식 정리 후 실행")\n');
        assert.equal(state.status, "completed");
    } finally {
        if (childPid && processExists(childPid)) globalThis.process.kill(childPid);
    }
});

test("no discoverable Python gives an installation hint before opening a server", async () => {
    const emptyPath = await mkdtemp(path.join(workspace, "empty-python-path-"));
    const child = spawn(executable, ["--project", workspace, "--no-browser"], {
        cwd: emptyPath, windowsHide: true,
        env: environmentWithPath(emptyPath, { PYTHON_EXE: path.join(workspace, "missing-python.exe") })
    });
    let text = "";
    child.stdout.on("data", (chunk) => { text += chunk; });
    child.stderr.on("data", (chunk) => { text += chunk; });
    try {
        const [exitCode] = await once(child, "exit", { signal: AbortSignal.timeout(30000) });
        assert.notEqual(exitCode, 0, text);
        assert.match(text, /Python|PYTHON_EXE/);
        assert.doesNotMatch(text, /PLAYGROUND_URL=/);
    } finally {
        await terminate(child);
    }
});

test("an invalid PYTHON_EXE falls back to a supported Python on PATH", async () => {
    const probe = spawn("python", ["-c", "import sys; print(sys.executable)"], {
        windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
    });
    let pythonPath = "";
    probe.stdout.on("data", (chunk) => { pythonPath += chunk; });
    assert.equal((await once(probe, "exit"))[0], 0, "This test requires a working PATH python");
    const originalPath = Object.entries(globalThis.process.env)
        .find(([name]) => name.toLowerCase() === "path")?.[1] ?? "";
    const child = spawn(executable, ["--project", workspace, "--no-browser"], {
        cwd: tmpdir(), windowsHide: true,
        env: environmentWithPath(path.dirname(pythonPath.trim()) + path.delimiter + originalPath,
            { PYTHON_EXE: path.join(workspace, "missing-python.exe") })
    });
    let text = "";
    child.stdout.on("data", (chunk) => { text += chunk; });
    child.stderr.on("data", (chunk) => { text += chunk; });
    try {
        await waitFor(() => text.includes("PLAYGROUND_URL=") || child.exitCode !== null,
            "Fallback host neither started nor exited", 15000);
        assert.match(text, /PLAYGROUND_URL=/);
        assert.equal(child.exitCode, null);
    } finally {
        await terminate(child);
    }
});

test("Korean Python paths work with no PATH and legacy inherited encoding", async () => {
    const project = path.join(workspace, "인터프리터 실습");
    const virtualEnvironment = path.join(workspace, "한글 공백 파이썬");
    const python = path.join(virtualEnvironment, "Scripts", "python.exe");
    await mkdir(project);
    await copyFile(path.join(toolRoot, "distribution", "playground.py"), path.join(project, "playground.py"));
    await writeFile(path.join(project, "main.py"),
        'import sys\nfrom playground import cat\ncat.forward(25)\n' +
        'print("INTERPRETER=" + sys.executable)\nprint("한글 인터프리터 완료")\n', "utf8");

    const creator = spawn("python", ["-m", "venv", "--without-pip", virtualEnvironment], {
        windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
    });
    let creationOutput = "";
    creator.stdout.on("data", (chunk) => { creationOutput += chunk; });
    creator.stderr.on("data", (chunk) => { creationOutput += chunk; });
    try {
        const [exitCode] = await once(creator, "exit", { signal: AbortSignal.timeout(30000) });
        assert.equal(exitCode, 0, creationOutput);
    } finally {
        await terminate(creator);
    }

    const child = spawn(executable, ["--project", project, "--no-browser"], {
        cwd: project, windowsHide: true,
        env: environmentWithPath("", {
            PYTHON_EXE: python, PYTHONUTF8: "0", PYTHONIOENCODING: "cp949"
        })
    });
    let text = "";
    let localSocket;
    let localState;
    child.stdout.on("data", (chunk) => { text += chunk; });
    child.stderr.on("data", (chunk) => { text += chunk; });

    try {
        await waitFor(() => text.includes("PLAYGROUND_URL=") || child.exitCode !== null,
            "Korean interpreter host neither started nor exited", 15000);
        assert.match(text, /PLAYGROUND_URL=/);
        const url = new URL(text.match(/PLAYGROUND_URL=(http:\/\/[^\s]+)/)[1]);
        const credential = new URLSearchParams(url.hash.slice(1)).get("token");
        localSocket = new WebSocket(`${url.origin.replace("http:", "ws:")}/ws?token=${credential}`);
        localSocket.addEventListener("message", ({ data }) => {
            localState = { ...localState, ...JSON.parse(data) };
        });
        await once(localSocket, "open");
        await waitFor(() => localState, "Korean interpreter initial snapshot missing");
        const response = await fetch(`${url.origin}/api/run`, {
            method: "POST", headers: { "X-Playground-Token": credential },
            signal: AbortSignal.timeout(15000)
        });
        assert.equal(response.status, 200, await response.text());
        await waitFor(() => ["completed", "error"].includes(localState.status),
            "Korean interpreter main.py did not finish");
        assert.equal(localState.status, "completed", JSON.stringify(localState));
        assert.ok(Math.abs(localState.x - 25) < 0.001);
        const lines = localState.output.map((line) => line.text);
        assert.ok(lines.includes("INTERPRETER=" + python), JSON.stringify(lines));
        assert.ok(lines.includes("한글 인터프리터 완료"), JSON.stringify(lines));
    } finally {
        localSocket?.close();
        await terminate(child);
    }
});

test("distribution includes the .NET and ASP.NET runtimes and all local web assets", async () => {
    const runtime = path.join(practice, "_runtime");
    for (const name of ["coreclr.dll", "hostpolicy.dll", "System.Private.CoreLib.dll",
        "Microsoft.AspNetCore.Server.Kestrel.Core.dll", "wwwroot/index.html", "wwwroot/app.js"]) {
        assert.ok((await readFile(path.join(runtime, name))).length > 0, name);
    }
    const config = JSON.parse(await readFile(path.join(runtime,
        "BlackThunder.BlackPy.runtimeconfig.json"), "utf8"));
    assert.ok(config.runtimeOptions.includedFrameworks?.length > 0);
    assert.equal(config.runtimeOptions.framework, undefined);
});

test("distribution preserves BlackPy and dependency license notices", async () => {
    const licenses = path.join(practice, "_runtime", "licenses");
    const notices = [
        ["BlackPy.LICENSE.md", path.join(toolRoot, "LICENSE.md")],
        ["UniEngine.LICENSE.md", path.join(toolRoot, "packages", "UniEngine.LICENSE.md")],
        ["BlackboxSystem.LICENSE.md", path.join(toolRoot, "packages", "BlackboxSystem.LICENSE.md")]
    ];

    for (const [name, source] of notices) {
        const expected = await readFile(source);
        assert.ok(expected.length > 0, name);
        assert.deepEqual(await readFile(path.join(licenses, name)), expected, name);
    }
});

test("distribution includes notices for the exact bundled .NET runtime packs", async () => {
    const runtime = path.join(practice, "_runtime");
    const dependencies = JSON.parse(await readFile(path.join(runtime, "BlackThunder.BlackPy.deps.json"), "utf8"));
    const runtimePacks = Object.entries(dependencies.libraries)
        .filter(([, library]) => library.type === "runtimepack")
        .map(([name]) => {
            assert.ok(name.startsWith("runtimepack."), name);
            const [packageId, version] = name.slice("runtimepack.".length).split("/");
            assert.ok(packageId && version, name);
            return { packageId, version };
        });

    for (const framework of ["Microsoft.NETCore.App.Runtime.", "Microsoft.AspNetCore.App.Runtime."]) {
        assert.ok(runtimePacks.some(({ packageId }) => packageId.startsWith(framework)), framework);
    }

    for (const { packageId, version } of runtimePacks) {
        for (const name of ["LICENSE.txt", "THIRD-PARTY-NOTICES.txt"]) {
            const notice = path.join(runtime, "licenses", packageId, version, name);
            assert.ok((await readFile(notice, "utf8")).trim().length > 0, notice);
        }
    }
});

const activities = [
    ["1. 도시를 가로지르는 자동차", "city", [[160, -140]]],
    ["2. 댄스 파티", "dance", [[0, 0]]],
    ["3. 달리기 경주", "track", [[260, 80], [260, -100]]],
    ["4. 농구공 드리블", "court", [[120, -80], [190, -180]]],
    ["5. 으스스한 숲", "forest", [[60, -150], [40, 100]]]
];

for (const [name, background, positions] of activities) {
    test(`BlackPy activity completes its real Python animation: ${name}`, async () => {
        sceneHistory = [];
        const source = await readFile(path.join(toolRoot, "examples", name, "main.py"), "utf8");
        await complete(source, "/api/run", 18000);
        assert.equal(state.status, "completed", outputText());
        assert.equal(state.scene.active, true);
        assert.equal(state.scene.background, background);
        assert.equal(state.scene.sprites.length, positions.length);
        assert.ok(sceneHistory.length > 10, "Animation must stream intermediate frames");
        for (let i = 0; i < positions.length; i++) {
            assert.ok(Math.abs(state.scene.sprites[i].x - positions[i][0]) < 0.001);
            assert.ok(Math.abs(state.scene.sprites[i].y - positions[i][1]) < 0.001);
        }
        if (background === "track") {
            assert.match(outputText(), /경주 결과: 고양이/);
            assert.ok(sceneHistory.some(({ sprites }) => sprites.length === 2 &&
                sprites[0].x > -250 && sprites[0].x < sprites[1].x && sprites[1].x < 250));
        }
        if (background === "court") {
            assert.ok(sceneHistory.some(({ sprites }) => sprites.length === 2 &&
                sprites[1].y > -90 && sprites[0].x > -230));
        }
        if (background === "forest" || background === "dance") {
            assert.ok(sceneHistory.some(({ sprites }) => sprites.some((sprite) =>
                Math.abs(sprite.heading) > 80 && Math.abs(sprite.heading) < 350)));
        }
    });
}

test("scene stop preserves position; restart resets scene and rejects old frames", async () => {
    await code('from blackpy import Actor, stage\nstage.background("city")\n' +
        'car = Actor("car")\ncar.forward(50000)\n');
    assert.equal((await request("/api/run")).status, 200);
    await waitFor(() => state.status === "running" && state.scene?.sprites[0]?.x > 20,
        "New actor did not start moving");
    const oldRun = state.runId;
    assert.equal((await request("/api/stop")).status, 200);
    const stopped = (await request("/api/state")).body;
    await pause(100);
    assert.deepEqual((await request("/api/state")).body.scene, stopped.scene);
    await code("import time\ntime.sleep(2)\n");
    assert.equal((await request("/api/restart")).status, 200);
    await waitFor(() => state.runId !== oldRun, "New run ID missing");
    assert.equal(state.scene.active, false);
    assert.equal(state.scene.sprites.length, 0);
    assert.equal((await request("/api/frame", { runId: oldRun, scene: stopped.scene })).status, 409);
    assert.equal((await request("/api/frame", { runId: state.runId, scene: {
        background: "city", sprites: [{ id: "bad", kind: "car", width: -1, height: 70 }]
    } })).status, 400);
    assert.equal((await request("/api/frame", { runId: state.runId, scene: stopped.scene }, "wrong")).status, 401);
    assert.equal((await request("/api/stop")).status, 200);
});

test("last browser disconnect stops a scene and reconnect preserves the final frame", async () => {
    await code('from blackpy import Actor, stage\nstage.background("forest")\n' +
        'bat = Actor("bat")\nbat.left(50000)\n');
    assert.equal((await request("/api/run")).status, 200);
    await waitFor(() => state.status === "running" && state.scene?.sprites[0]?.heading > 15,
        "Bat did not rotate");
    socket.close();
    await waitFor(async () => (await request("/api/state")).body.status === "stopped",
        "Scene survived browser disconnect");
    const stopped = (await request("/api/state")).body;
    socket = await connect();
    assert.equal(state.status, "stopped");
    assert.deepEqual(state.scene, stopped.scene);
});

test("force terminating the host also terminates the student Python and its descendant", async () => {
    let parentPid;
    let childPid;
    try {
        await code('import os, subprocess, sys, time\n' +
            'child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])\n' +
            'print(f"PARENT_PID={os.getpid()} CHILD_PID={child.pid}", flush=True)\n' +
            'time.sleep(60)\n');
        const previous = state.runId;
        assert.equal((await request("/api/run")).status, 200);
        await waitFor(() => state.runId !== previous && /PARENT_PID=\d+ CHILD_PID=\d+/.test(outputText()),
            "The Python process tree did not start");
        const match = outputText().match(/PARENT_PID=(\d+) CHILD_PID=(\d+)/);
        parentPid = Number(match[1]);
        childPid = Number(match[2]);
        assert.ok(processExists(parentPid) && processExists(childPid));
        await terminate(process);
        await waitFor(() => !processExists(parentPid) && !processExists(childPid),
            "The Python process tree survived host termination");
    } finally {
        for (const pid of [parentPid, childPid]) {
            if (pid && processExists(pid)) globalThis.process.kill(pid);
        }
    }
});
