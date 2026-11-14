import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { defaultProject, TestHost, wheelPath } from "./TestHost.mjs";

const environment = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
delete environment.BLACKPY_AUTO_RUN;
const invoke = (executable, args, options = {}) => execFileSync(executable, args, {
    cwd: tmpdir(), windowsHide: true, encoding: "utf8", timeout: 120000, env: environment, ...options
});

function stopTree(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    try {
        invoke("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"]);
    } catch { /* The launcher and its children may already have exited. */ }
}

function runPython(python, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(python, args, {
            cwd: tmpdir(), windowsHide: true, env: environment,
            stdio: ["ignore", "pipe", "pipe"], ...options
        });
        let output = "";
        const timer = setTimeout(() => {
            stopTree(child);
            reject(new Error(`Ordinary Python did not exit: ${output}`));
        }, 15000);
        child.stdout.on("data", bytes => { output += bytes.toString(); });
        child.stderr.on("data", bytes => { output += bytes.toString(); });
        child.on("error", error => { clearTimeout(timer); reject(error); });
        child.on("close", code => { clearTimeout(timer); resolve({ code, output }); });
    });
}

async function assertPlainPython(python, args, expected, options = {}) {
    const result = await runPython(python, args, options);
    assert.equal(result.code, 0, result.output);
    assert.equal(result.output.trim(), expected);
    assert.doesNotMatch(result.output, /PLAYGROUND_URL=/);
}

test("installed direct-file execution opens only the selected BlackPy project", async context => {
    const root = await mkdtemp(path.join(tmpdir(), "BlackPy 파일 실행 한글 "));
    const venv = path.join(root, "venv");
    const python = path.join(venv, "Scripts", "python.exe");
    const workspace = path.join(root, "학생 프로젝트");
    const otherDirectory = path.join(root, "다른 작업 폴더");
    const wheel = wheelPath;
    const project = defaultProject();
    const sources = {
        "project.json": JSON.stringify(project),
        "배경.py": '말하기("배경 초기화")\ndef 시작():\n    말하기("배경 전체 실행", 시간=None)\n',
        "고양이.py": '좌표로(23, 45)\ndef 시작():\n    말하기("고양이 전체 실행", 시간=None)\n',
        "자동차.py": 'import student_helper\ndef 시작():\n    좌표로(67, 89)\n' +
            '    말하기("자동차 전체 실행", 시간=None)\n    print(student_helper.MESSAGE)\n',
        "student_helper.py": 'MESSAGE = "학생 모듈 유지"\n',
        "직접 실행.py": 'print("PLAIN_PYTHON")\n',
        "blackpy.py": 'This is intentionally invalid Python !!!\n',
        "json.py": 'raise RuntimeError("STUDENT_JSON_IMPORTED")\n',
        "argparse.py": 'raise RuntimeError("STUDENT_ARGPARSE_IMPORTED")\n',
        "plain_module.py": 'print("MODULE_PYTHON")\n',
        "별도.pyw": 'print("PYW_PYTHON")\n'
    };
    await mkdir(workspace);
    await mkdir(otherDirectory);
    for (const [name, source] of Object.entries(sources)) {
        await writeFile(path.join(workspace, name), source);
    }
    invoke(process.env.PYTHON_EXE || "python", ["-m", "venv", venv]);
    const plainFile = path.join(workspace, "직접 실행.py");

    await context.test("without an installed package the file remains ordinary Python", async () => {
        await assertPlainPython(python, [plainFile, "--no-browser"], "PLAIN_PYTHON");
    });
    invoke(python, ["-m", "pip", "install", "--no-index", "--no-deps", wheel]);

    await context.test("unrelated scripts and Python entry modes are unchanged", async () => {
        const ordinaryFile = path.join(otherDirectory, "ordinary.py");
        await writeFile(ordinaryFile, 'print("ORDINARY_PYTHON")\n');
        await assertPlainPython(python, [ordinaryFile, "--no-browser"], "ORDINARY_PYTHON",
            { cwd: workspace });
        await writeFile(path.join(otherDirectory, "project.json"), '{"name":"unrelated project"}');
        await assertPlainPython(python, [ordinaryFile, "--no-browser"], "ORDINARY_PYTHON");
        await writeFile(path.join(otherDirectory, "project.json"), '{"background":');
        await assertPlainPython(python, [ordinaryFile, "--no-browser"], "ORDINARY_PYTHON");
        const nested = path.join(workspace, "nested");
        await mkdir(nested);
        const nestedFile = path.join(nested, "ordinary.py");
        await writeFile(nestedFile, 'print("NESTED_PYTHON")\n');
        await assertPlainPython(python, [nestedFile, "--no-browser"], "NESTED_PYTHON");
        await assertPlainPython(python, ["-c", "import sys; print('blackpy' in sys.modules)"], "False",
            { cwd: workspace });
        await assertPlainPython(python, ["-m", "plain_module", "--no-browser"], "MODULE_PYTHON",
            { cwd: workspace });
        await assertPlainPython(python, [path.join(workspace, "별도.pyw"), "--no-browser"], "PYW_PYTHON");
        await assertPlainPython(python, ["-S", plainFile, "--no-browser"], "PLAIN_PYTHON");
    });

    await context.test("the explicit opt-out runs the original file normally", async () => {
        await assertPlainPython(python, [plainFile, "--no-browser"], "PLAIN_PYTHON",
            { env: { ...environment, BLACKPY_AUTO_RUN: "0" } });
    });

    async function launchFile(name, check) {
        const host = new TestHost();
        try {
            await host.open({ workspace, executable: python,
                args: [path.join(workspace, name), "--no-browser", "--port", "0"],
                cwd: otherDirectory, env: { ...environment, PYTHONPATH: workspace } });
            const metadata = await host.request("/api/project");
            assert.equal(metadata.status, 200);
            assert.deepEqual(metadata.body.actors, project.actors.map(actor => ({
                physics: "충돌만", trigger: false, mass: 1, ...actor
            })));
            assert.equal(metadata.body.background.file, project.background.file);
            await host.run();
            await host.done();
            await check(host);
            assert.doesNotMatch(host.output + host.text(),
                /PLAIN_PYTHON|MODULE_PYTHON|STUDENT_JSON_IMPORTED|STUDENT_ARGPARSE_IMPORTED/);
            host.socket.close();
            await host.wait(() => host.child.exitCode !== null, "direct-file launcher shutdown");
            assert.equal(host.child.exitCode, 0, host.output);
        } finally {
            stopTree(host.child);
            await host.close();
        }
    }

    for (const name of ["배경.py", "고양이.py", "직접 실행.py", "blackpy.py"]) {
        await context.test(`${name} opens the entire project without executing the file directly`, async () => {
            await launchFile(name, async host => {
                assert.equal(host.state.status, "completed", host.text());
                assert.equal(host.state.scene.message, "배경 전체 실행");
                assert.equal(host.sprite("고양이").x, 23);
                assert.equal(host.sprite("고양이").y, 45);
                assert.equal(host.sprite("고양이").speech, "고양이 전체 실행");
                assert.equal(host.sprite("자동차").x, 67);
                assert.equal(host.sprite("자동차").y, 89);
                assert.equal(host.sprite("자동차").speech, "자동차 전체 실행");
                assert.match(host.text(), /학생 모듈 유지/);
            });
        });
    }

    await context.test("nested settings keep direct execution rooted at the student files", async () => {
        await mkdir(path.join(workspace, "_blackpy"));
        await writeFile(path.join(workspace, "_blackpy", "project.json"), sources["project.json"]);
        await launchFile("고양이.py", async host => {
            assert.equal(host.state.status, "completed", host.text());
            assert.equal(host.sprite("고양이").speech, "고양이 전체 실행");
        });
    });

    await context.test("a selected registered file with invalid syntax reports its error in the stage", async () => {
        const source = path.join(workspace, "고양이.py");
        await writeFile(source, "def 시작()\n    pass\n");
        try {
            await launchFile("고양이.py", async host => {
                assert.equal(host.state.status, "error", host.text());
                assert.match(host.text(), /SyntaxError/);
                assert.match(host.text(), /고양이\.py/);
            });
        } finally {
            await writeFile(source, sources["고양이.py"]);
        }
    });

    await context.test("uninstall removes the hook and preserves every student file", async () => {
        invoke(python, ["-m", "pip", "uninstall", "-y", "blackpy"]);
        await assertPlainPython(python, [plainFile, "--no-browser"], "PLAIN_PYTHON");
        await assertPlainPython(python, ["-I", "-c",
            "import importlib.util; print(importlib.util.find_spec('_blackpy_autostart'))"], "None");
        await assert.rejects(access(path.join(venv, "Lib", "site-packages", "blackpy_autostart.pth")),
            { code: "ENOENT" });
        for (const [name, source] of Object.entries(sources)) {
            assert.equal(await readFile(path.join(workspace, name), "utf8"), source);
        }
    });
});
