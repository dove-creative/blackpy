import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import vm from "node:vm";

const root = new URL("../src/BlackThunder.BlackPy/wwwroot/", import.meta.url);
const scripts = await Promise.all(["input.js", "text-input.js", "palette.js", "app.js"]
    .map(name => readFile(new URL(name, root), "utf8")));
const project = {
    background: { file: "배경.py", kind: "plain" },
    actors: [{ name: "고양이", file: "고양이.py", kind: "cat" }, { name: "자동차", file: "자동차.py", kind: "car" }]
};

function eventTarget(extra = {}) {
    const listeners = new Map();
    return {
        ...extra,
        addEventListener(name, callback) {
            const callbacks = listeners.get(name) || [];
            callbacks.push(callback);
            listeners.set(name, callbacks);
        },
        emit(name, event = {}) {
            let prevented = false;
            const value = { preventDefault() { prevented = true; }, ...event };
            for (const callback of listeners.get(name) || []) callback(value);
            return prevented;
        }
    };
}

function browser({ clipboardError } = {}) {
    const elements = new Map();
    const requests = [];
    const copied = [];
    const captured = new Set();
    const document = eventTarget({ hidden: false, activeElement: null });
    const element = id => {
        if (!elements.has(id)) {
            const classes = new Set();
            const node = eventTarget({
                textContent: "", dataset: {}, hidden: false, value: "", children: [],
                style: { setProperty() {} },
                classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
                setAttribute(name, value) { this[name] = value; },
                replaceChildren(...children) { this.children = children; },
                appendChild(child) { this.children.push(child); },
                append(...children) { this.children.push(...children); },
                focus() { document.activeElement = this; this.emit("focus"); },
                setPointerCapture(id) { captured.add(id); },
                hasPointerCapture(id) { return captured.has(id); },
                releasePointerCapture(id) { captured.delete(id); this.emit("lostpointercapture"); },
                getContext: () => ({}),
                getBoundingClientRect: () => ({ left: 10, top: 20, width: 402, height: 302 })
            });
            elements.set(id, node);
        }
        return elements.get(id);
    };
    document.getElementById = element;
    document.querySelector = element;
    document.createElement = () => element(Symbol());
    document.createDocumentFragment = () => ({ appendChild() {} });
    let socket;
    class WebSocket {
        constructor() { socket = eventTarget({ close() {} }); return socket; }
    }
    const window = eventTarget({
        location: { hash: "#token=abc", protocol: "http:", host: "127.0.0.1:1234" },
        requestAnimationFrame() {}, devicePixelRatio: 2, setTimeout
    });
    const context = vm.createContext({
        window, document, WebSocket, URLSearchParams, AbortController, AbortSignal,
        setTimeout, clearTimeout,
        navigator: { clipboard: { async writeText(code) {
            if (clipboardError) throw new Error("복사를 허용해 주세요.");
            copied.push(code);
        } } },
        getComputedStyle: () => ({
            borderLeftWidth: "1px", borderTopWidth: "1px", borderRightWidth: "1px", borderBottomWidth: "1px"
        }),
        async fetch(url, options) {
            requests.push({ url, body: options.body ? JSON.parse(options.body) : null });
            return { ok: true, status: 200, json: async () => url === "/api/project" ? project : ({}) };
        }
    });
    for (const source of scripts) vm.runInContext(source, context);
    socket.emit("open");
    const state = (runId, status = "running", scene = null, output) => socket.emit("message", {
        data: JSON.stringify({ type: "snapshot", runId, status, scene, output })
    });
    const inputs = () => requests.filter(request => request.url === "/api/input").map(request => request.body);
    return { document, window, element, requests, state, inputs, copied, captured };
}

test("stage keys require focus; repeat, browser shortcuts and Tab are not sent", async () => {
    const app = browser();
    app.state("one");
    const canvas = app.element("stage");
    assert.equal(canvas.emit("keydown", { key: "ArrowLeft", code: "ArrowLeft" }), false);
    canvas.focus();
    assert.equal(canvas.emit("keydown", { key: "Tab", code: "Tab" }), false);
    assert.equal(canvas.emit("keydown", { key: "s", code: "KeyS", ctrlKey: true }), false);
    assert.equal(canvas.emit("keydown", { key: "ArrowLeft", code: "ArrowLeft" }), true);
    assert.equal(canvas.emit("keydown", { key: "ArrowLeft", code: "ArrowLeft", repeat: true }), true);
    app.window.emit("keyup", { key: "ArrowLeft", code: "ArrowLeft" });
    await setImmediate();
    assert.deepEqual(app.inputs().map(packet => packet.kind), ["keydown", "keyup"]);
    assert.equal(app.inputs()[0].key, "왼쪽");
});

test("left press captures pointer and an outside release uses bounded stage coordinates", async () => {
    const app = browser();
    app.state("one");
    const canvas = app.element("stage");
    assert.equal(canvas.emit("pointerdown", { button: 2, pointerId: 7, clientX: 211, clientY: 171 }), false);
    canvas.emit("pointerdown", { button: 0, pointerId: 7, clientX: 211, clientY: 171 });
    assert.equal(app.captured.has(7), true);
    canvas.emit("pointermove", { pointerId: 7, clientX: 411, clientY: 21 });
    canvas.emit("pointerup", { button: 0, pointerId: 8, clientX: 900, clientY: 900 });
    assert.equal(app.captured.has(7), true);
    canvas.emit("pointerup", { button: 0, pointerId: 7, clientX: 900, clientY: 900 });
    assert.equal(app.captured.has(7), false);
    await setImmediate();
    assert.deepEqual(app.inputs(), [
        { kind: "pointerdown", button: "왼쪽", x: 0, y: 0, runId: "one" },
        { kind: "pointermove", x: 400, y: 300, runId: "one" },
        { kind: "pointerup", button: "왼쪽", x: 400, y: 300, runId: "one" }
    ]);
});

test("start and restart move focus to the stage so the first key reaches the new run", async () => {
    const app = browser();
    app.state("one", "completed");
    const canvas = app.element("stage");
    for (const [button, action, runId] of [["start-button", "/api/run", "two"], ["restart-button", "/api/restart", "three"]]) {
        app.document.activeElement = app.element(button);
        app.element(button).emit("click");
        assert.equal(app.document.activeElement, canvas);
        await setImmediate();
        assert.ok(app.requests.some(request => request.url === action));
        app.state(runId);
        assert.equal(canvas.emit("keydown", { key: "ArrowUp", code: "ArrowUp" }), true);
        app.window.emit("keyup", { key: "ArrowUp", code: "ArrowUp" });
        await setImmediate();
        assert.deepEqual(app.inputs().filter(packet => packet.runId === runId).map(packet => packet.kind),
            ["keydown", "keyup"]);
        app.state(runId, "completed");
    }
    assert.match(app.element("input-hint").textContent, /바로 키보드/);
});

test("focus loss resets held input and completed runs accept neither keys nor presses", async () => {
    const app = browser();
    app.state("one");
    const canvas = app.element("stage");
    canvas.focus();
    canvas.emit("keydown", { key: "a", code: "KeyA" });
    app.document.activeElement = app.element("stop-button");
    canvas.emit("blur");
    await setImmediate();
    assert.deepEqual(app.inputs().map(packet => packet.kind), ["keydown", "reset"]);
    app.state("one", "completed");
    canvas.focus();
    assert.equal(canvas.emit("keydown", { key: "a", code: "KeyA" }), false);
    assert.equal(canvas.emit("pointerdown", { button: 0, pointerId: 1, clientX: 211, clientY: 171 }), false);
    assert.equal(canvas.emit("contextmenu"), false);
    await setImmediate();
    assert.equal(app.inputs().length, 2);
});

test("common palette needs no object selection and does not send runtime input", async () => {
    const app = browser();
    await setImmediate();
    assert.equal(app.element("categories").children.length, 6);
    const html = await readFile(new URL("index.html", root), "utf8");
    assert.doesNotMatch(html, /target-select|target-file|누구의 코드를/);
    assert.match(html, /<link rel="icon" href="favicon\.svg" type="image\/svg\+xml">/);
    assert.match(app.element("category-description").textContent, /빈 곳/);
    app.element("categories").children[1].emit("click");
    const forward = app.element("command-cards").children.find(card => card.children[0]?.textContent === "앞으로");
    assert.equal(forward.children[0].children[0].textContent, "캐릭터 전용");
    forward.children[1].emit("click");
    await setImmediate();
    assert.deepEqual(app.copied, ["앞으로(100)"]);
    assert.equal(app.inputs().length, 0);
});

test("all actor positions and live lookup names update without object selection", async () => {
    const app = browser();
    await setImmediate();
    app.state("one", "running", {
        active: true,
        sprites: [
            { id: "actor-1", label: '고양이 "하나"', x: 15, y: 20, heading: 90 },
            { id: "actor-2", label: '자동차 "둘"', x: 100, y: 40, heading: 0 }
        ]
    });
    await setImmediate();
    assert.equal(app.element("position-report").hidden, false);
    assert.deepEqual(Array.from(app.element("position-report").children, row => row.textContent), [
        '고양이 "하나" · x 15 · y 20 · 방향 90°', '자동차 "둘" · x 100 · y 40 · 방향 0°'
    ]);
    app.element("categories").children[5].emit("click");
    const positionCard = app.element("command-cards").children
        .find(card => card.children[0]?.textContent === "다른 캐릭터의 위치");
    positionCard.children[1].emit("click");
    await setImmediate();
    assert.deepEqual(app.copied, ['위치_구하기("고양이 \\"하나\\"")']);
    app.state("two", "running", null);
    await setImmediate();
    assert.match(app.element("position-report").children[0].textContent, /^고양이 ·/);
    const resetCard = app.element("command-cards").children
        .find(card => card.children[0]?.textContent === "다른 캐릭터의 위치");
    resetCard.children[1].emit("click");
    await setImmediate();
    assert.equal(app.copied.at(-1), '위치_구하기("고양이")');
});

test("each code row copies a complete event template and announces success", async () => {
    const app = browser();
    await setImmediate();
    const cards = app.element("command-cards").children;
    cards[1].children[2].emit("click");
    await setImmediate();
    assert.deepEqual(app.copied, ["def 키_누름_중(누른_키):\n    pass"]);
    assert.match(app.element("copy-status").textContent, /복사했어요/);
    assert.match(app.element("copy-status").textContent, /Python 파일/);
});

test("clipboard rejection is reported instead of claiming success", async () => {
    const app = browser({ clipboardError: true });
    await setImmediate();
    app.element("command-cards").children[0].children[1].emit("click");
    await setImmediate();
    assert.equal(app.copied.length, 0);
    assert.match(app.element("copy-status").textContent, /복사하지 못했어요|허용/);
});

test("text questions release game keys, keep typing across frames and send an answer instead of game input", async () => {
    const app = browser();
    app.state("one");
    const canvas = app.element("stage");
    canvas.focus();
    canvas.emit("keydown", { key: "ArrowLeft", code: "ArrowLeft" });
    const scene = { active: true, sprites: [], textInput: { id: 1, message: "이름은?", actor: "고양이" } };
    app.state("one", "running", scene);
    const answer = app.element("text-input-answer");
    assert.equal(app.document.activeElement, answer);
    assert.equal(app.element("text-input-form").hidden, false);
    answer.value = "  한글 이름  ";
    app.state("one", "running", scene);
    assert.equal(answer.value, "  한글 이름  ");
    assert.equal(app.element("stop-button").disabled, false);
    assert.equal(app.element("restart-button").disabled, false);
    answer.emit("keydown", { key: "ArrowLeft", code: "ArrowLeft" });
    app.window.emit("keyup", { key: "ArrowLeft", code: "ArrowLeft" });
    app.element("text-input-form").emit("submit");
    await setImmediate();
    assert.deepEqual(app.inputs().filter(packet => packet.kind !== "answer").map(packet => packet.kind),
        ["keydown", "reset"]);
    assert.deepEqual(app.inputs().find(packet => packet.kind === "answer"), {
        runId: "one", promptId: 1, kind: "answer", text: "  한글 이름  "
    });
    app.state("one", "completed", scene);
    assert.equal(app.element("text-input-form").hidden, true);
    assert.equal(answer.value, "");
});

test("console input hides the empty placeholder and scrolls only when a new prompt opens", () => {
    const app = browser();
    const consoleArea = app.element(".console-area");
    consoleArea.scrollHeight = 1000;
    consoleArea.clientHeight = 134;
    consoleArea.scrollTop = 0;
    app.state("one", "running", null, []);
    assert.equal(app.element("output-placeholder").hidden, false);
    const scene = { active: true, sprites: [], textInput: { id: 1, message: "숫자: ", actor: "고양이" } };
    app.state("one", "running", scene);
    assert.equal(app.element("output-placeholder").hidden, true);
    assert.equal(consoleArea.scrollTop, 1000);
    app.element("text-input-answer").value = "12";
    consoleArea.scrollTop = 0;
    app.state("one", "running", scene);
    assert.equal(consoleArea.scrollTop, 0);
    assert.equal(app.element("text-input-answer").value, "12");
    app.state("one", "running", null, [{ stream: "stdout", text: "숫자: 12" }]);
    assert.equal(app.element("text-input-form").hidden, true);
    assert.equal(app.element("output-placeholder").hidden, true);
    assert.equal(consoleArea.scrollTop, 0);
    app.state("two", "running", null, []);
    assert.equal(app.element("output-placeholder").hidden, false);
});
