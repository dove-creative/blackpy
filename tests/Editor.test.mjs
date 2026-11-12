import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { toolRoot } from "./TestHost.mjs";

const pyright = path.join(toolRoot, ".cache/editor-tools/node_modules/pyright/index.js");
const analyze = directory => {
    const result = spawnSync(process.execPath,
        [pyright, "--outputjson", "--pythonversion", "3.10", directory], {
            cwd: directory, windowsHide: true, encoding: "utf8", timeout: 30000
        });
    assert.ok(result.status === 0 || result.status === 1, result.stderr || String(result.error));
    return JSON.parse(result.stdout);
};

test("implicit commands are recognized while misspellings and wrong argument types remain errors", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "BlackPy editor "));
    await cp(path.join(toolRoot, "distribution/project"), directory, { recursive: true });
    await writeFile(path.join(directory, "test.py"),
        'def 시작():\n    말하기("안녕")\n    앞으로(100)\n    바라보기(90)\n    바라보기(1, 2)\n    print(len(이름), 위치_구하기("고양이"))\n');
    const valid = analyze(directory);
    assert.equal(valid.summary.errorCount, 0, JSON.stringify(valid.generalDiagnostics));
    assert.equal(valid.summary.warningCount, 0, JSON.stringify(valid.generalDiagnostics));
    await writeFile(path.join(directory, "test.py"),
        'def 시작():\n    말하가("오타")\n    말하기(123)\n');
    const invalid = analyze(directory);
    assert.equal(invalid.summary.errorCount, 2, JSON.stringify(invalid.generalDiagnostics));
    assert.ok(invalid.generalDiagnostics.some(item => item.rule === "reportUndefinedVariable"));
    assert.ok(invalid.generalDiagnostics.some(item => item.rule === "reportArgumentType"));
});

for (const name of ["01-movement", "02-keyboard", "03-click", "04-broadcast", "05-contact"]) {
    test(`${name} has no unknown BlackPy command diagnostics`, async () => {
        const directory = await mkdtemp(path.join(tmpdir(), "BlackPy sample editor "));
        await cp(path.join(toolRoot, "samples", name), directory, { recursive: true });
        const result = analyze(directory);
        assert.equal(result.summary.errorCount, 0, JSON.stringify(result.generalDiagnostics));
        assert.equal(result.summary.warningCount, 0, JSON.stringify(result.generalDiagnostics));
    });
}
