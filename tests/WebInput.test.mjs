import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { normalizeKey, stagePoint, InputQueue } =
    require("../src/BlackThunder.BlackPy/wwwroot/input.js");

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
}

test("pointer coordinates keep the center and positive-up axes at different display scales", () => {
    for (const scale of [0.25, 1, 2]) {
        const rectangle = { left: 17, top: 31, width: 800 * scale, height: 600 * scale };
        assert.deepEqual(stagePoint(17 + 400 * scale, 31 + 300 * scale, rectangle), { x: 0, y: 0 });
        assert.deepEqual(stagePoint(17, 31, rectangle), { x: -400, y: 300 });
        assert.deepEqual(stagePoint(17 + 800 * scale, 31 + 600 * scale, rectangle), { x: 400, y: -300 });
    }
});

test("letterbox and border-excluded content rectangles do not create outside-stage input", () => {
    const rectangle = { left: 20, top: 20, width: 800, height: 800 };
    assert.deepEqual(stagePoint(420, 420, rectangle), { x: 0, y: 0 });
    assert.deepEqual(stagePoint(20, 120, rectangle), { x: -400, y: 300 });
    assert.equal(stagePoint(420, 50, rectangle), null);
    assert.equal(stagePoint(19, 420, rectangle), null);
    assert.equal(stagePoint(0, 0, { left: 0, top: 0, width: 0, height: 0 }), null);
});

test("only supported keys are normalized", () => {
    assert.equal(normalizeKey("ArrowLeft"), "왼쪽");
    assert.equal(normalizeKey("ArrowDown"), "아래");
    assert.equal(normalizeKey(" "), "스페이스");
    assert.equal(normalizeKey("Enter"), "엔터");
    assert.equal(normalizeKey("Escape"), "탈출");
    assert.equal(normalizeKey("A"), "a");
    assert.equal(normalizeKey("?"), "?");

    for (const key of ["Tab", "Control", "Dead", "Process", "한", "F5", "", undefined]) {
        assert.equal(normalizeKey(key), null);
    }

});

test("input is serialized and only consecutive queued pointer movements are coalesced", async () => {
    const first = deferred();
    const packets = [];
    const queue = new InputQueue(packet => {
        packets.push(packet);
        return packets.length === 1 ? first.promise : Promise.resolve();
    }, assert.fail);
    queue.setRun("one");
    queue.enqueue({ kind: "keydown", key: "왼쪽" });
    queue.enqueue({ kind: "pointermove", x: 1, y: 2 });
    queue.enqueue({ kind: "pointermove", x: 3, y: 4 });
    queue.enqueue({ kind: "pointerdown", button: "왼쪽", x: 5, y: 6 });
    queue.enqueue({ kind: "pointermove", x: 7, y: 8 });
    queue.enqueue({ kind: "keyup", key: "왼쪽" });
    assert.equal(packets.length, 1);
    first.resolve();
    await setImmediate();
    assert.deepEqual(packets.map(packet => packet.kind),
        ["keydown", "pointermove", "pointerdown", "pointermove", "keyup"]);
    assert.equal(packets[1].x, 3);
    assert.ok(packets.every(packet => packet.runId === "one"));
});

test("a restart discards old pending inputs and aborts the old request without disturbing the new run", async () => {
    const oldRequest = deferred();
    const newRequest = deferred();
    const packets = [];
    const signals = [];
    const queue = new InputQueue((packet, signal) => {
        packets.push(packet);
        signals.push(signal);
        return packet.runId === "old" ? oldRequest.promise : newRequest.promise;
    }, assert.fail);
    queue.setRun("old");
    queue.enqueue({ kind: "keydown", key: "a" });
    queue.enqueue({ kind: "pointerdown", button: "왼쪽" });
    queue.setRun("new");
    queue.enqueue({ kind: "keydown", key: "b" });
    assert.equal(signals[0].aborted, true);
    oldRequest.reject(new Error("old connection aborted"));
    await setImmediate();
    assert.equal(queue.busy, true);
    assert.deepEqual(packets.map(packet => packet.runId), ["old", "new"]);
    newRequest.resolve();
    await setImmediate();
    assert.equal(queue.busy, false);
});

test("focus-loss reset follows the in-flight key event and replaces all pending events", async () => {
    const first = deferred();
    const packets = [];
    const queue = new InputQueue(packet => {
        packets.push(packet);
        return packets.length === 1 ? first.promise : Promise.resolve();
    }, assert.fail);
    queue.setRun("one");
    queue.enqueue({ kind: "keydown", key: "왼쪽" });
    queue.enqueue({ kind: "keydown", key: "위" });
    queue.enqueue({ kind: "pointerdown", button: "왼쪽" });
    queue.enqueue({ kind: "reset", x: 0, y: 0 });
    first.resolve();
    await setImmediate();
    assert.deepEqual(packets.map(packet => packet.kind), ["keydown", "reset"]);
});

test("queue saturation is bounded and clears potentially held input through reset", async () => {
    const first = deferred();
    const packets = [];
    const errors = [];
    const queue = new InputQueue(packet => {
        packets.push(packet);
        return packets.length === 1 ? first.promise : Promise.resolve();
    }, error => errors.push(error), 2);
    queue.setRun("one");
    queue.enqueue({ kind: "keydown", key: "왼쪽" });
    queue.enqueue({ kind: "pointerdown", button: "왼쪽" });
    queue.enqueue({ kind: "pointerdown", button: "왼쪽" });
    assert.equal(queue.enqueue({ kind: "keyup", key: "왼쪽" }), false);
    assert.equal(queue.pending.length, 1);
    first.resolve();
    await setImmediate();
    assert.deepEqual(packets.map(packet => packet.kind), ["keydown", "reset"]);
    assert.equal(errors.length, 1);
});

test("a failed send attempts one reset and cannot retry forever on a disconnected server", async () => {
    const packets = [];
    const errors = [];
    const queue = new InputQueue(async packet => {
        packets.push(packet);
        throw new Error("disconnected");
    }, error => errors.push(error));
    queue.setRun("one");
    queue.enqueue({ kind: "keydown", key: "왼쪽" });
    await setImmediate();
    assert.deepEqual(packets.map(packet => packet.kind), ["keydown", "reset"]);
    assert.equal(queue.busy, false);
    assert.equal(queue.pending.length, 0);
    queue.setRun(null);
    assert.equal(queue.enqueue({ kind: "keydown", key: "오른쪽" }), false);
    assert.equal(packets.length, 2);
});
