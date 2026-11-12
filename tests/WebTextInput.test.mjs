import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { TextInput } = require("../src/BlackThunder.BlackPy/wwwroot/text-input.js");

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
}

function element() {
    const listeners = new Map();
    return {
        value: "", textContent: "", hidden: false, disabled: false, focusCount: 0,
        addEventListener(name, callback) { listeners.set(name, callback); },
        setAttribute(name, value) { this[name] = value; },
        focus() { this.focusCount++; },
        emit(name, extra = {}) {
            let prevented = false;
            listeners.get(name)?.({ preventDefault() { prevented = true; }, ...extra });
            return prevented;
        }
    };
}

function controller(send = async () => {}) {
    const elements = Object.fromEntries(["form", "label", "answer", "submit", "status"]
        .map(name => [name, element()]));
    let opened = 0;
    const input = new TextInput(elements, send, () => { opened++; });
    return { input, elements, opened: () => opened };
}

const question = (id = 1, message = "이름은 무엇인가요?") => ({ id, message, actor: "고양이" });

test("a prompt focuses once and repeated frames preserve the answer and literal question", () => {
    const { input, elements, opened } = controller();
    assert.equal(elements.form.hidden, true);
    input.update("run", question(1, "<img src=x onerror=alert(1)>"));
    assert.equal(elements.form.hidden, false);
    assert.equal(elements.label.textContent, "<img src=x onerror=alert(1)>");
    assert.equal(elements.answer["aria-label"], "<img src=x onerror=alert(1)>");
    elements.answer.value = "  고양이  ";
    input.update("run", question(1));
    assert.equal(elements.answer.value, "  고양이  ");
    assert.equal(elements.answer.focusCount, 1);
    assert.equal(opened(), 1);
    input.update("run", question(2, ""));
    assert.equal(elements.answer.value, "");
    assert.equal(elements.label.textContent, "");
    assert.equal(elements.answer["aria-label"], "입력");
    assert.equal(elements.answer.focusCount, 2);
});

test("empty and whitespace answers are submitted unchanged once per prompt", async () => {
    const packets = [];
    const { input, elements } = controller(async packet => packets.push(packet));

    for (const [index, text] of ["", "  가 나  "].entries()) {
        input.update("run", question(index + 1));
        elements.answer.value = text;
        await input.submit();
        await input.submit();
        input.update("run", question(index + 1));
        assert.equal(elements.submit.disabled, true);
        assert.equal(elements.answer.value, text);
    }

    assert.deepEqual(packets, [
        { runId: "run", promptId: 1, kind: "answer", text: "" },
        { runId: "run", promptId: 2, kind: "answer", text: "  가 나  " }
    ]);
});

test("pending submissions cannot be sent twice and a failed send keeps the answer for retry", async () => {
    const first = deferred();
    let attempts = 0;
    const { input, elements } = controller(() => ++attempts === 1 ? first.promise : Promise.resolve());
    input.update("run", question());
    elements.answer.value = "민수";
    const pending = input.submit();
    await input.submit();
    assert.equal(attempts, 1);
    assert.equal(elements.answer.disabled, true);
    first.reject(new Error("연결을 확인해 주세요."));
    await pending;
    assert.equal(elements.answer.value, "민수");
    assert.equal(elements.answer.disabled, false);
    assert.match(elements.status.textContent, /연결을 확인/);
    await input.submit();
    assert.equal(attempts, 2);
    assert.equal(elements.submit.disabled, true);
});

test("a new run aborts an old request and ignores its late completion", async () => {
    const old = deferred();
    let signal;
    const { input, elements } = controller((packet, requestSignal) => {
        signal = requestSignal;
        return old.promise;
    });
    input.update("old", question());
    elements.answer.value = "이전 답";
    const pending = input.submit();
    input.update("new", question());
    assert.equal(signal.aborted, true);
    assert.equal(elements.answer.value, "");
    elements.answer.value = "새 답";
    old.resolve();
    await pending;
    assert.equal(elements.answer.value, "새 답");
    assert.equal(elements.submit.disabled, false);
    assert.equal(elements.status.textContent, "");
});

test("run end and disconnect clear the draft and cancel the pending request", async () => {
    for (const unavailable of [null, undefined]) {
        const pending = deferred();
        let signal;
        const { input, elements } = controller((packet, requestSignal) => {
            signal = requestSignal;
            return pending.promise;
        });
        input.update("run", question());
        elements.answer.value = "저장하지 않을 답";
        const sent = input.submit();
        input.update(unavailable, question());
        assert.equal(signal.aborted, true);
        assert.equal(elements.form.hidden, true);
        assert.equal(elements.answer.value, "");
        assert.equal(elements.label.textContent, "");
        pending.reject(new Error("cancelled"));
        await sent;
        assert.equal(elements.status.textContent, "");
    }
});

test("IME composition never submits the unfinished Korean syllable", async () => {
    const packets = [];
    const { input, elements } = controller(async packet => packets.push(packet));
    input.update("run", question());
    elements.answer.emit("compositionstart");
    assert.equal(elements.answer.emit("keydown", { key: "Enter", isComposing: true }), true);
    elements.form.emit("submit");
    await setImmediate();
    assert.equal(packets.length, 0);
    elements.answer.emit("compositionend");
    assert.equal(elements.answer.emit("keydown", { key: "Enter", keyCode: 229 }), true);
    assert.equal(elements.answer.emit("keydown", { key: "Enter" }), false);
    elements.answer.value = "한글";
    assert.equal(elements.form.emit("submit"), true);
    await setImmediate();
    assert.equal(packets[0].text, "한글");
});

test("temporary action disabling preserves the draft and does not refocus it", async () => {
    let sent = false;
    const { input, elements } = controller(async () => { sent = true; });
    input.update("run", question());
    elements.answer.value = "답";
    input.update("run", question(), true);
    await input.submit();
    assert.equal(sent, false);
    input.update("run", question());
    assert.equal(elements.answer.value, "답");
    assert.equal(elements.answer.focusCount, 1);
    assert.equal(elements.submit.disabled, false);
});

test("a prompt arriving during the start request focuses once after the controls become available", () => {
    const { input, elements, opened } = controller();
    input.update("run", question(), true);
    assert.equal(elements.answer.focusCount, 0);
    input.update("run", question(), false);
    assert.equal(elements.answer.focusCount, 1);
    input.update("run", question(), false);
    assert.equal(elements.answer.focusCount, 1);
    assert.equal(opened(), 1);
});

test("oversized and multiline programmatic values are rejected without losing the draft", async () => {
    const packets = [];
    const { input, elements } = controller(async packet => packets.push(packet));
    input.update("run", question());

    for (const value of ["x".repeat(4097), "a\nb", "a\rb"]) {
        elements.answer.value = value;
        await input.submit();
        assert.equal(packets.length, 0);
        assert.equal(elements.answer.value, value);
        assert.match(elements.status.textContent, /4,096자/);
    }

    elements.answer.value = "x".repeat(4096);
    await input.submit();
    assert.equal(packets.length, 1);
});
