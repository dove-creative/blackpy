import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import vm from "node:vm";

const root = new URL("../src/BlackThunder.BlackPy/wwwroot/", import.meta.url);
const scripts = await Promise.all(["input.js", "palette.js", "app.js"]
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
    const state = (runId, status = "running", scene = null) => socket.emit("message", {
        data: JSON.stringify({ type: "snapshot", runId, status, scene })
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

test("target selection changes palette and filename, without sending runtime input", async () => {
    const app = browser();
    await setImmediate();
    assert.equal(app.element("target-file").textContent, "고양이.py");
    assert.equal(app.element("categories").children.length, 5);
    const select = app.element("target-select");
    select.value = "배경";
    select.emit("change");
    assert.equal(app.element("target-file").textContent, "배경.py");
    assert.equal(app.element("categories").children.length, 4);
    assert.match(app.element("category-description").textContent, /빈 곳/);
    assert.equal(app.inputs().length, 0);
});

test("each code row copies a complete event template and announces success", async () => {
    const app = browser();
    await setImmediate();
    const cards = app.element("command-cards").children;
    cards[1].children[2].emit("click");
    await setImmediate();
    assert.deepEqual(app.copied, ["def 키_클릭_중(누른_키):\n    pass"]);
    assert.match(app.element("copy-status").textContent, /복사했어요/);
    assert.match(app.element("copy-status").textContent, /고양이.py/);
});

test("clipboard rejection is reported instead of claiming success", async () => {
    const app = browser({ clipboardError: true });
    await setImmediate();
    app.element("command-cards").children[0].children[1].emit("click");
    await setImmediate();
    assert.equal(app.copied.length, 0);
    assert.match(app.element("copy-status").textContent, /복사하지 못했어요|허용/);
});
