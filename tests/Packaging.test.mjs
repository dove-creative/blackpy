import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { TestHost, wheelPath } from "./TestHost.mjs";

test("installed wheel creates, runs, reinstalls and uninstalls without changing student files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "BlackPy pip 한글 "));
    const wheel = wheelPath;
    const environment = path.join(root, "venv");
    const python = path.join(environment, "Scripts/python.exe");
    const command = path.join(environment, "Scripts/blackpy.exe");
    const invoke = (exe, args) => execFileSync(exe, args, {
        cwd: root, windowsHide: true, encoding: "utf8", timeout: 120000,
        env: { ...process.env, PYTHONUTF8: "1" }
    });
    invoke(process.env.PYTHON_EXE || "python", ["-m", "venv", environment]);
    const inspection = JSON.parse(invoke(python, ["-c", `
import json, sys, zipfile
from email.parser import Parser
with zipfile.ZipFile(sys.argv[1]) as wheel:
    names = wheel.namelist()
    info = next(name for name in names if name.endswith('.dist-info/METADATA'))
    metadata = Parser().parsestr(wheel.read(info).decode('utf-8'))
    print(json.dumps({'names': names, 'python': metadata['Requires-Python'],
                      'metadata': metadata['Metadata-Version'], 'version': metadata['Version'],
                      'requires': metadata.get_all('Requires-Dist', [])}))
`, wheel]));
    assert.equal(inspection.python, ">=3.10");
    assert.equal(inspection.metadata, "2.4");
    assert.deepEqual(inspection.requires, []);
    for (const name of ["blackpy/_runtime/BlackThunder.BlackPy.exe", "blackpy/_runtime/coreclr.dll",
        "blackpy/_runtime/_blackpy_runner.py", "blackpy/_runtime/wwwroot/index.html",
        "blackpy/_runtime/licenses/BlackPy.LICENSE.md", "blackpy/_runtime/licenses/UniEngine.LICENSE.md",
        "blackpy/_runtime/licenses/BlackboxSystem.LICENSE.md", "blackpy/_templates/_blackpy/__builtins__.pyi",
        "blackpy/_runtime/licenses/Box2D.NET.LICENSE.md", "blackpy/_runtime/Box2D.NET.dll",
        "_blackpy_autostart.py", "blackpy_autostart.pth", "blackpy/_editor/__builtins__.pyi"]) {
        assert.ok(inspection.names.includes(name), name);
    }
    assert.ok(inspection.names.some(name => name.endsWith("/THIRD-PARTY-NOTICES.txt")));
    assert.ok(inspection.names.every(name => !name.includes("__pycache__") && !name.endsWith(".pyc")));
    const install = ["-m", "pip", "install", "--no-index", "--no-deps", wheel];
    invoke(python, install);
    assert.equal(invoke(command, ["--version"]).trim(), `BlackPy ${inspection.version}`);
    const workspace = path.join(root, "내 프로젝트");
    invoke(command, ["new", workspace]);
    assert.ok((await readdir(workspace)).every(name => name === "_blackpy" || name.endsWith(".py")));
    const stub = await readFile(path.join(workspace, "_blackpy", "__builtins__.pyi"));
    assert.match(stub.toString(), /def 말하기/);
    const source = 'import sys\ndef 시작():\n    print(sys.executable)\n    말하기("wheel에서 실행", 시간=None)\n    좌표로(23, 45)\n';
    await writeFile(path.join(workspace, "고양이.py"), source);
    const host = new TestHost();

    try {
        await host.open({ workspace, executable: command,
            args: ["run", workspace, "--no-browser"],
            env: { ...process.env, PYTHON_EXE: "deliberately-invalid-python", PYTHONUTF8: "1" } });
        await host.run();
        await host.wait(() => host.sprite("고양이")?.x === 23 &&
            host.text().includes(python), "installed interpreter and Korean commands");
        assert.equal(host.sprite("고양이").y, 45);
        assert.equal(host.sprite("고양이").speech, "wheel에서 실행");
        host.socket.close();
        await host.wait(() => host.child.exitCode !== null, "pip launcher exits with last browser");
        assert.equal(host.child.exitCode, 0, host.output);
    } finally {
        if (host.child && host.child.exitCode === null) {
            try {
                invoke("taskkill.exe", ["/PID", String(host.child.pid), "/T", "/F"]);
            } catch { /* The launcher's process tree may already have exited. */ }
        }
        await host.close();
    }

    invoke(python, [...install, "--force-reinstall"]);
    assert.equal(await readFile(path.join(workspace, "고양이.py"), "utf8"), source);
    invoke(python, ["-m", "blackpy", "editor", workspace]);
    assert.deepEqual(await readFile(path.join(workspace, "_blackpy", "__builtins__.pyi")), stub);
    invoke(python, ["-m", "pip", "uninstall", "-y", "blackpy"]);
    assert.equal(await readFile(path.join(workspace, "고양이.py"), "utf8"), source);
    assert.deepEqual(await readFile(path.join(workspace, "_blackpy", "__builtins__.pyi")), stub);
    assert.equal(invoke(python, ["-I", "-c", "import importlib.util; print(importlib.util.find_spec('blackpy'))"]).trim(), "None");
});
