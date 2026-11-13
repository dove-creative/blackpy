import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { TestHost, executable, distributionRoot, toolRoot, wheelPath } from "./TestHost.mjs";

const names = ["01-movement", "02-keyboard", "03-click", "04-broadcast", "05-contact", "06-physics"];
const basePython = process.env.PYTHON_EXE || "python";
const environment = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
const invoke = (executable, args, options = {}) => execFileSync(executable, args, {
    cwd: tmpdir(), windowsHide: true, encoding: "utf8", timeout: 120000, env: environment, ...options
});

async function studentFiles(directory) {
    const files = (await readdir(directory, { recursive: true })).filter(name => name.endsWith(".py") ||
        name.endsWith(".pyi") || path.basename(name) === "project.json");
    return Object.fromEntries(await Promise.all(files.map(async name =>
        [name, (await readFile(path.join(directory, name))).toString("base64")])));
}

test("sample launchers require an installed package throughout install and uninstall", async context => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "BlackPy 설치형 샘플 "));
    const pythonEnvironment = path.join(temporaryRoot, "venv");
    const python = path.join(pythonEnvironment, "Scripts", "python.exe");
    const wheel = wheelPath;
    const canonical = await readFile(path.join(toolRoot, "scripts", "SampleLauncher.pyw"));
    const original = {};

    await mkdir(path.join(temporaryRoot, "artifacts"));
    await symlink(distributionRoot, path.join(temporaryRoot, "artifacts", "blackpy"), "junction");
    await access(executable);
    for (const name of names) {
        const source = path.join(toolRoot, "samples", name);
        const workspace = path.join(temporaryRoot, "samples", name);
        assert.ok(!(await readdir(source)).includes("시작.exe"), "Samples must not retain a local-runtime launcher");
        original[name] = await studentFiles(source);
        await cp(source, workspace, { recursive: true });
        assert.deepEqual(await readFile(path.join(workspace, "_blackpy", "시작.pyw")), canonical);
        assert.ok((await readdir(source)).every(file => file === "_blackpy" || file.endsWith(".py")));
        await writeFile(path.join(workspace, "blackpy.py"), 'raise RuntimeError("LOCAL_BLACKPY_LOADED")\n');
    }
    invoke(basePython, ["-m", "venv", pythonEnvironment]);

    const launcher = path.join(temporaryRoot, "samples", names[0], "_blackpy", "시작.pyw");
    const launchEnvironment = { ...environment, PYTHONPATH: path.join(toolRoot, "distribution") };
    const assertMissing = () => {
        const result = spawnSync(python, [launcher, "--console", "--no-browser"], {
            cwd: toolRoot, windowsHide: true, encoding: "utf8", timeout: 15000, env: launchEnvironment
        });
        assert.ifError(result.error);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /pip install blackpy/);
        assert.doesNotMatch(result.stdout + result.stderr, /PLAYGROUND_URL=|LOCAL_BLACKPY_LOADED/);
    };

    await context.test("missing package reports installation even when a local runtime is available", assertMissing);
    invoke(python, ["-m", "pip", "install", "--no-index", "--no-deps", wheel]);

    for (const name of names) {
        await context.test(`${name} uses its own project and exits with the last browser`, async () => {
            const workspace = path.join(temporaryRoot, "samples", name);
            const expected = JSON.parse(await readFile(path.join(workspace, "_blackpy", "project.json"), "utf8"));
            const host = new TestHost();

            try {
                await host.open({ workspace, executable: python,
                    args: [path.join(workspace, "_blackpy", "시작.pyw"), "--console", "--no-browser", "--port", "0"],
                    cwd: toolRoot, env: launchEnvironment });
                const metadata = await host.request("/api/project");
                assert.equal(metadata.status, 200);
                assert.deepEqual(metadata.body.actors, expected.actors.map(actor => ({
                    heading: 0, scale: 1, speed: 1, visible: true, physics: "충돌만", trigger: false, mass: 1, ...actor
                })));
                assert.equal(metadata.body.background.kind, expected.background.kind);
                await host.run();
                await host.wait(() => host.state?.scene?.message?.length > 0, "installed sample start event");
                host.socket.close();
                await host.wait(() => host.child.exitCode !== null, "installed sample shutdown");
                assert.equal(host.child.exitCode, 0, host.output);
            } finally {
                if (host.child && host.child.exitCode === null) {
                    try {
                        invoke("taskkill.exe", ["/PID", String(host.child.pid), "/T", "/F"]);
                    } catch { /* The launcher and its children may already have exited. */ }
                }
                await host.close();
            }
        });
    }

    await context.test("uninstall disables the launcher without changing sample code", async () => {
        invoke(python, ["-m", "pip", "uninstall", "-y", "blackpy"]);
        assertMissing();
        for (const name of names) {
            assert.deepEqual(await studentFiles(path.join(toolRoot, "samples", name)), original[name]);
            const copied = await studentFiles(path.join(temporaryRoot, "samples", name));
            delete copied["blackpy.py"];
            assert.deepEqual(copied, original[name]);
        }
    });
});

test("windowless launch reports a missing package in a dialog and does not allocate a console", () => {
    const result = JSON.parse(invoke(basePython, ["-c", `
import ctypes, json, pathlib, runpy, subprocess, sys
from unittest.mock import MagicMock, patch

launcher = runpy.run_path(sys.argv[1], run_name="sample_launcher_test")
console_python = str(pathlib.Path(sys.executable).with_name("python.exe"))
window_python = str(pathlib.Path(sys.executable).with_name("pythonw.exe"))
child = MagicMock()
child.__enter__.return_value = child
child.communicate.return_value = ("", "")
child.returncode = 86
library = MagicMock()
with patch("subprocess.Popen", return_value=child) as launch, \\
     patch.object(ctypes, "WinDLL", return_value=library), \\
     patch.object(sys, "executable", window_python), \\
     patch.object(sys, "stdout", None), patch.object(sys, "stderr", None):
    code = launcher["main"]([])
    args, options = launch.call_args
    dialog = library.MessageBoxW
    result = {"code": code, "message": dialog.call_args.args[1], "dialog_count": dialog.call_count,
              "same_python": args[0][0] == console_python,
              "hidden": bool(options.get("creationflags", 0) & subprocess.CREATE_NO_WINDOW),
              "captures_errors": options.get("stderr") == subprocess.PIPE}
print(json.dumps(result))
`, path.join(toolRoot, "scripts", "SampleLauncher.pyw")]));
    assert.notEqual(result.code, 0);
    assert.match(result.message, /pip install blackpy/);
    assert.equal(result.dialog_count, 1);
    assert.equal(result.same_python, true);
    assert.equal(result.hidden, true);
    assert.equal(result.captures_errors, true);
});
