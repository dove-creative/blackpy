import assert from "node:assert/strict";
import { test } from "node:test";
import { TestHost, pause } from "./TestHost.mjs";

test("closing the final browser exits the host and its Python descendants", { timeout: 20000 }, async t => {
    const host = await new TestHost().open();
    t.after(() => host.close());
    await host.write('import subprocess\nimport sys\ndef 시작():\n' +
        '    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])\n' +
        '    print("CHILD_PID", child.pid)\n    while True:\n        기다리기(1)\n');
    await host.run();
    await host.wait(() => host.text().includes("CHILD_PID"), "child startup");
    const pid = Number(host.text().match(/CHILD_PID (\d+)/)[1]);
    const disconnected = Date.now();
    host.socket.close();
    await host.wait(() => host.child.exitCode !== null, "automatic host shutdown", 10000);
    assert.equal(host.child.exitCode, 0, host.output);
    assert.ok(Date.now() - disconnected >= 2500, "the reconnect grace should precede host shutdown");
    await host.wait(() => {
        try { process.kill(pid, 0); return false; }
        catch (error) { if (error.code === "ESRCH") return true; throw error; }
    }, "Python descendant cleanup");
});

test("one remaining browser keeps the host alive beyond the disconnect grace", { timeout: 15000 }, async t => {
    const host = await new TestHost().open();
    t.after(() => host.close());
    const second = await host.connect();
    host.socket.close();
    host.socket = second;
    await pause(3300);
    assert.equal(host.child.exitCode, null, host.output);
    assert.equal((await host.request("/api/state")).status, 200);
});

test("a browser refresh cancels pending host shutdown while retaining the stopped scene", {
    timeout: 15000
}, async t => {
    const host = await new TestHost().open();
    t.after(() => host.close());
    await host.write('def 시작():\n    위치 = (70, 20)\n    print("장면 준비")\n\n' +
        'def 자신_클릭():\n    pass\n');
    await host.run();
    await host.wait(() => host.sprite()?.x === 70 && host.text().includes("장면 준비"), "scene preparation");
    host.socket.close();
    await host.wait(async () => (await host.request("/api/state")).body.status === "stopped",
        "last browser stops student execution");
    await pause(200);
    host.socket = await host.connect();
    await pause(3300);
    assert.equal(host.child.exitCode, null, host.output);
    assert.equal(host.state.status, "stopped");
    assert.equal(host.sprite().x, 70);
    assert.match(host.text(), /장면 준비/);
});
