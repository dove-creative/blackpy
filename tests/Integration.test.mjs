import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { TestHost, defaultProject, pause } from "./TestHost.mjs";

const host = new TestHost();
before(async () => { await host.open(); });
beforeEach(async () => { await host.stop(); });
after(async () => { await host.close(); });

test("authentication and missing project never create student files", async () => {
    assert.equal((await host.request("/api/state", undefined, "wrong")).status, 401);
    const response = await host.request("/api/run");
    assert.equal(response.status, 400);
    assert.match(response.body.error, /project\.json/);
    await assert.rejects(readFile(path.join(host.workspace, "project.json")), { code: "ENOENT" });
});

test("normal moves finish before the next line and actors move simultaneously", async () => {
    await host.write('def 시작():\n    print("CAT_BEGIN")\n    앞으로(100)\n    print("고양이 도착 🐱")\n',
        'def 시작():\n    print("CAR_BEGIN")\n    앞으로(100)\n    print("자동차 도착")\n');
    const started = Date.now();
    await host.run();
    await host.done();
    assert.equal(host.state.status, "completed", host.text());
    assert.ok(Date.now() - started >= 450);
    assert.ok(Math.abs(host.sprite().x) < 0.01);
    assert.ok(Math.abs(host.sprite("자동차").x - 50) < 0.01);
    const text = host.text();
    assert.match(text, /고양이 도착 🐱/);
    assert.match(text, /자동차 도착/);
    const firstArrival = Math.min(text.indexOf("고양이 도착 🐱"), text.indexOf("자동차 도착"));
    const catStarted = text.indexOf("CAT_BEGIN");
    const carStarted = text.indexOf("CAR_BEGIN");
    assert.ok(catStarted >= 0 && catStarted < firstArrival && carStarted >= 0 && carStarted < firstArrival,
        "Both actors must begin before either movement finishes: " + text);
});

test("state assignments and helper calls bind to their own actor", async () => {
    await host.write('def 돌기():\n    방향 += 90\n\ndef 시작():\n    위치 = (12, 25)\n' +
        '    크기 = 2\n    속도 = 2\n    돌기()\n    앞으로(20)\n    말하기("내 말풍선")\n',
        'def 시작():\n    위치 = (100, -25)\n    말하기("자동차 말풍선")\n');
    await host.run();
    await host.done();
    assert.equal(host.state.status, "completed", host.text());
    assert.ok(Math.abs(host.sprite().x - 12) < 0.01);
    assert.ok(Math.abs(host.sprite().y - 45) < 0.01);
    assert.equal(host.sprite().width, 172);
    assert.equal(host.sprite().speech, "내 말풍선");
    assert.equal(host.sprite("자동차").speech, "자동차 말풍선");
});

test("all scripts and settings stay frozen until restart", async () => {
    const source = 'def 시작():\n    기다리기(0.5)\n    print("원본 고양이")\n\ndef 자신_클릭():\n    pass\n';
    await host.write(source, 'def 시작():\n    기다리기(0.5)\n    print("원본 자동차")\n');
    await host.run();
    const run = host.state.runId;
    const replacement = defaultProject();
    replacement.actors[0].x = -250;
    await host.write('def 시작():\n    print("수정 고양이")\n',
        'def 시작():\n    print("수정 자동차")\n', "", replacement);
    assert.equal((await host.request("/api/project")).body.actors[0].x, -100);
    const snapshot = (await host.request("/api/source?runId=" + run)).body;
    assert.equal(snapshot.sources.length, 3);
    const saved = snapshot.sources.find(file => file.filename.endsWith("고양이.py"));
    assert.equal(Buffer.from(saved.source, "base64").toString("utf8"), source);
    await host.wait(() => host.text().includes("원본 자동차") && host.text().includes("원본 고양이"), "frozen outputs");
    assert.doesNotMatch(host.text(), /수정/);
    await host.run("/api/restart");
    await host.done();
    assert.equal(host.state.status, "completed", host.text());
    assert.match(host.text(), /수정 고양이/);
    assert.match(host.text(), /수정 자동차/);
    assert.equal(host.sprite().x, -250);
    assert.equal((await host.request("/api/input", { runId: run, kind: "reset" })).status, 409);
});

test("errors show the original filename, line and frozen source", async () => {
    await host.write('def 시작():\n    기다리기(0.4)\n    raise ValueError("원본 오류")\n');
    await host.run();
    await writeFile(path.join(host.workspace, "고양이.py"), 'print("수정 파일")\n');
    await host.done();
    assert.equal(host.state.status, "error");
    assert.match(host.text(), /고양이\.py.*line 3/s);
    assert.match(host.text(), /raise ValueError\("원본 오류"\)/);
    assert.doesNotMatch(host.text(), /수정 파일/);
    await host.write('def 시작()\n    pass\n');
    await host.run();
    await host.done();
    assert.equal(host.state.status, "error");
    assert.match(host.text(), /SyntaxError/);
});

test("tight loops yield to other actors and remain stoppable", async () => {
    await host.write('def 시작():\n    while True:\n        pass\n',
        'def 시작():\n    앞으로(20)\n    print("다른 실행도 진행")\n');
    await host.run();
    await host.wait(() => host.text().includes("다른 실행도 진행"), "cooperative loop");
    assert.equal((await host.request("/api/run")).status, 409);
    await host.stop();
    await host.wait(() => host.state.status === "stopped", "loop stop");
    const x = host.sprite("자동차").x;
    await pause(100);
    assert.equal(host.sprite("자동차").x, x);
});

test("project validation rejects unsafe paths and duplicate actors", async () => {
    const config = defaultProject();
    config.actors[0].file = "../outside.py";
    await host.write("", "", "", config);
    assert.equal((await host.request("/api/run")).status, 400);
    await host.write("", "", "", { ...defaultProject(), actors: [defaultProject().actors[0], defaultProject().actors[0]] });
    assert.equal((await host.request("/api/run")).status, 400);
});

test("last browser disconnect stops execution and reconnect retains the scene", async () => {
    await host.write('def 시작():\n    위치 = (70, 20)\n    print("연결 확인")\n\ndef 자신_클릭():\n    pass\n');
    await host.run();
    await host.wait(() => host.text().includes("연결 확인"), "disconnect preparation");
    const extra = await host.connect();
    host.socket.close();
    host.socket = extra;
    await pause(100);
    assert.equal((await host.request("/api/state")).body.status, "running");
    extra.close();
    await host.wait(async () => (await host.request("/api/state")).body.status === "stopped", "last disconnect");
    host.socket = await host.connect();
    assert.equal(host.sprite().x, 70);
    assert.match(host.text(), /연결 확인/);
});

test("nonfinite state fails with a student error and output remains bounded", async () => {
    await host.write('def 시작():\n    속도 = float("nan")\n');
    await host.run();
    await host.done();
    assert.equal(host.state.status, "error");
    assert.match(host.text(), /속도|숫자|유한/);
    await host.write('import sys\ndef 시작():\n    for i in range(1200):\n' +
        '        print("OUT", i)\n        print("ERR", i, file=sys.stderr)\n' +
        '    print("STDOUT_DONE")\n    print("STDERR_DONE", file=sys.stderr)\n');
    await host.run();
    await host.done(20000);
    assert.equal(host.state.status, "completed", host.text());
    assert.equal(host.state.output.length, 1000);
    assert.match(host.text(), /STDOUT_DONE/);
    assert.match(host.text(), /STDERR_DONE/);
});

test("stopping the run also terminates Python child processes", async () => {
    await host.write('import subprocess\nimport sys\ndef 시작():\n' +
        '    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])\n' +
        '    print("CHILD_PID", child.pid)\n    while True:\n        기다리기(1)\n');
    await host.run();
    await host.wait(() => host.text().includes("CHILD_PID"), "child process startup");
    const pid = Number(host.text().match(/CHILD_PID (\d+)/)[1]);
    process.kill(pid, 0);
    await host.stop();
    await host.wait(() => {
        try { process.kill(pid, 0); return false; }
        catch (error) { if (error.code === "ESRCH") return true; throw error; }
    }, "child process cleanup");
});
