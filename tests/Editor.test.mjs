import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { toolRoot, wheelPath } from "./TestHost.mjs";

const pyright = path.join(toolRoot, ".cache/editor-tools/node_modules/pyright/index.js");
const copyProject = async (source, directory) => {
    await cp(source, directory, { recursive: true });
    await writeFile(path.join(directory, "pyrightconfig.json"), JSON.stringify({ stubPath: "_blackpy" }));
};
const analyze = (directory, options = {}) => {
    const result = spawnSync(process.execPath,
        [pyright, "--outputjson", "--pythonversion", "3.10",
            ...(options.python ? ["--pythonpath", options.python] : []), directory], {
            cwd: options.cwd || directory, windowsHide: true, encoding: "utf8", timeout: 30000
        });
    assert.ok(result.status === 0 || result.status === 1, result.stderr || String(result.error));
    return JSON.parse(result.stdout);
};

test("installed commands work outside a workspace while ordinary diagnostics and custom stubs remain", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "BlackPy loose editor "));
    const directory = path.join(root, "학생 파일");
    const unrelated = path.join(root, "unrelated");
    const venv = path.join(root, "venv");
    const python = path.join(venv, "Scripts/python.exe");
    const source = path.join(directory, "공.py");
    const valid = 'def 시작():\n    물리_설정("물리")\n    무게_설정(1)\n'
        + '    힘_작용(90, 6)\n    정지()\n    말하기("점수", 3, 시간=1.5)\n    print(len("공"), int("1"))\n';
    const invoke = (executable, args) => execFileSync(executable, args, {
        cwd: unrelated, windowsHide: true, encoding: "utf8", timeout: 120000,
        env: { ...process.env, PYTHONUTF8: "1" }
    });
    await mkdir(directory);
    await mkdir(unrelated);
    await writeFile(source, valid);
    invoke(process.env.PYTHON_EXE || "python", ["-m", "venv", venv]);
    const inspect = () => analyze(source, { cwd: unrelated, python });
    assert.ok(inspect().generalDiagnostics.some(item => item.rule === "reportUndefinedVariable"));
    const install = ["-m", "pip", "install", "--no-index", "--no-deps", wheelPath];
    invoke(python, install);
    const installed = inspect();
    assert.equal(installed.summary.errorCount, 0, JSON.stringify(installed.generalDiagnostics));
    assert.equal(installed.summary.warningCount, 0, JSON.stringify(installed.generalDiagnostics));
    assert.equal(await readFile(source, "utf8"), valid);
    await assert.rejects(access(path.join(directory, "__builtins__.pyi")), { code: "ENOENT" });
    await assert.rejects(access(path.join(directory, ".vscode")), { code: "ENOENT" });

    await writeFile(source, '말하가("오타")\n무게_설정("무거움")\nprint(없는_이름)\n');
    const invalid = inspect();
    assert.equal(invalid.summary.errorCount, 3, JSON.stringify(invalid.generalDiagnostics));
    assert.equal(invalid.generalDiagnostics.filter(item => item.rule === "reportUndefinedVariable").length, 2);
    assert.equal(invalid.generalDiagnostics.filter(item => item.rule === "reportArgumentType").length, 1);

    const custom = path.join(venv, "Lib/site-packages/__builtins__.pyi");
    const customSource = "사용자_이름: int\n";
    await writeFile(custom, customSource);
    invoke(python, [...install, "--force-reinstall"]);
    assert.equal(await readFile(custom, "utf8"), customSource);
    await writeFile(source, "print(사용자_이름)\n");
    const customized = inspect();
    assert.equal(customized.summary.errorCount, 0, JSON.stringify(customized.generalDiagnostics));
    invoke(python, ["-m", "pip", "uninstall", "-y", "blackpy"]);
    assert.equal(await readFile(custom, "utf8"), customSource);
    assert.equal(await readFile(source, "utf8"), "print(사용자_이름)\n");
    await assert.rejects(access(path.join(venv, "Lib/site-packages/blackpy/_editor/__builtins__.pyi")),
        { code: "ENOENT" });
    const paths = JSON.parse(invoke(python, ["-c", "import json, sys; print(json.dumps(sys.path))"]));
    assert.ok(paths.every(entry => !entry.replaceAll("\\", "/").endsWith("blackpy/_editor")));
});

test("implicit commands are recognized while misspellings and wrong argument types remain errors", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "BlackPy editor "));
    await copyProject(path.join(toolRoot, "distribution/project"), directory);
    await writeFile(path.join(directory, "test.py"),
        'def 시작():\n    말하기("안녕")\n    앞으로(100)\n    바라보기(90)\n    바라보기(1, 2)\n'
        + '    왼쪽_돌기(10)\n    오른쪽_돌기(10)\n    물리_설정("물리")\n    무게_설정(10)\n'
        + '    힘_작용(90, 10)\n    정지()\n    이름_정하기("새 고양이")\n'
        + '    print(len(이름), 위치_구하기("고양이"), 물리, 무게, 닿은_객체_리스트)\n'
        + 'def 키_누름(누른_키):\n    말하기(누른_키, "키를 눌렀구나!")\n'
        + '    말하기("점수", 3, True, None, 시간=0.5)\n    말하기()\n');
    const valid = analyze(directory);
    assert.equal(valid.summary.errorCount, 0, JSON.stringify(valid.generalDiagnostics));
    assert.equal(valid.summary.warningCount, 0, JSON.stringify(valid.generalDiagnostics));
    await writeFile(path.join(directory, "test.py"),
        'def 시작():\n    말하가("오타")\n    말하기("키", 시간="1")\n    말하기("키", 없는_옵션=1)\n');
    const invalid = analyze(directory);
    assert.equal(invalid.summary.errorCount, 3, JSON.stringify(invalid.generalDiagnostics));
    assert.ok(invalid.generalDiagnostics.some(item => item.rule === "reportUndefinedVariable"));
    assert.ok(invalid.generalDiagnostics.some(item => item.rule === "reportArgumentType"));
});

test("physics mode choices and command argument types remain checked", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "BlackPy physics editor "));
    await copyProject(path.join(toolRoot, "distribution/project"), directory);
    await writeFile(path.join(directory, "test.py"),
        'def 시작():\n    물리_설정("다른")\n    무게_설정("무거움")\n    힘_작용("위", 10)\n');
    const result = analyze(directory);
    assert.equal(result.summary.errorCount, 3, JSON.stringify(result.generalDiagnostics));
    assert.ok(result.generalDiagnostics.every(item => item.rule === "reportArgumentType"));
});

for (const name of ["01-movement", "02-keyboard", "03-click", "04-broadcast", "05-contact", "06-physics"]) {
    test(`${name} has no unknown BlackPy command diagnostics`, async () => {
        const directory = await mkdtemp(path.join(tmpdir(), "BlackPy sample editor "));
        await copyProject(path.join(toolRoot, "samples", name), directory);
        const result = analyze(directory);
        assert.equal(result.summary.errorCount, 0, JSON.stringify(result.generalDiagnostics));
        assert.equal(result.summary.warningCount, 0, JSON.stringify(result.generalDiagnostics));
    });
}
