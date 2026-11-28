import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { hit, draw } = require("../src/BlackThunder.BlackPy/wwwroot/display.js");
const { previewScene } = require("../src/BlackThunder.BlackPy/wwwroot/palette.js");

test("display hit areas use stage coordinates, scale, and the topmost drawing", () => {
    const displays = previewScene({ displays: [
        { name: "큰 점수판", x: 100, y: 200, scale: 2 },
        { name: "앞 점수판", x: 100, y: 200 },
    ] }).displays;
    assert.equal(hit(displays, { x: 100, y: 200 }).name, "앞 점수판");
    assert.equal(hit(displays, { x: 300, y: 200 }).name, "큰 점수판");
    assert.equal(hit(displays, { x: 100, y: 301 }), undefined);
    assert.equal(displays[0].text, "—");
});

test("display draws literal text inside its bounded board and distinguishes an unbound name", () => {
    const lines = [];
    const context = new Proxy({}, { get(target, key) {
        if (key === "fillText") return (...args) => lines.push(args);
        return () => {};
    } });
    draw(context, { x: 0, y: 0, scale: 1, variable: "점수", text: "<b>3</b>" });
    assert.deepEqual(lines.map(line => line[0]), ["점수", "<b>3</b>"]);
    assert.ok(lines.every(line => line[3] === 196));
    lines.length = 0;
    draw(context, { x: 0, y: 0, scale: 1, name: "점수판", variable: "", text: "—" });
    assert.deepEqual(lines.map(line => line[0]), ["점수판", "변수 연결"]);
});
