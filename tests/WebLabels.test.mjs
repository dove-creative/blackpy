import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/BlackThunder.BlackPy/wwwroot/scene.js", import.meta.url), "utf8");

test("project label visibility hides nameplates while preserving speech and actor names", () => {
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    const text = [];
    const context = new Proxy({
        measureText: value => ({ width: value.length * 10 }),
        fillText: value => text.push(value),
    }, { get: (target, key) => key in target ? target[key] : () => {} });
    const sprite = { id: "actor-1", kind: "ball", visible: true, label: "공", speech: "도착!",
        x: 0, y: 0, width: 40, height: 40, heading: 0 };
    const scene = { background: "plain", sprites: [sprite] };
    const images = { background: {}, backgroundKind: "plain", actors: new Map([["actor-1", {}]]) };
    const draw = sandbox.window.BlackPySceneRenderer.draw;
    draw(context, scene, images);
    assert.deepEqual(text, ["공", "도착!"]);
    text.length = 0;
    draw(context, scene, images, { showLabels: false });
    assert.deepEqual(text, ["도착!"]);
    assert.equal(sprite.label, "공");
    text.length = 0;
    draw(context, scene, images, { showLabels: true });
    assert.deepEqual(text, ["공", "도착!"]);
});
