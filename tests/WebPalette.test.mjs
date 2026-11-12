import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { categories, availableCards, copyCode, previewScene } =
    require("../src/BlackThunder.BlackPy/wwwroot/palette.js");

function allCards(background) {
    return categories.flatMap(category => availableCards(category.id, background));
}

test("background exposes its own input events and excludes actor motion, visibility and contact", () => {
    const background = allCards(true).flatMap(card => card.rows.map(row => row.code));
    assert.ok(background.includes("def 자신_클릭():\n    pass"));
    assert.ok(background.includes('배경 = "city"'));
    assert.ok(background.includes("def 키_클릭_끝(누른_키):\n    pass"));
    assert.ok(background.includes("def 방송_받기(신호_이름):\n    pass"));
    assert.ok(background.every(code => !/앞으로|가시성|닿는_중|닿았을_때/.test(code)));
    const actor = allCards(false).flatMap(card => card.rows.map(row => row.code));
    assert.ok(actor.includes("def 닿는_중_종료(이름_리스트):\n    pass"));
    assert.ok(actor.includes("위치 = (0, 0)"));
    assert.ok(actor.includes("속도 = 1"));
    assert.ok(actor.every(code => !code.startsWith("배경 =")));
});

test("every copyable row is valid Python including complete event bodies", () => {
    const snippets = [...allCards(true), ...allCards(false)].flatMap(card => card.rows.map(row => row.code));
    const result = spawnSync(process.env.PYTHON_EXE || "python", ["-c",
        "import ast,json,sys; [ast.parse(source) for source in json.loads(sys.stdin.buffer.read().decode('utf-8'))]"], {
        input: JSON.stringify(snippets), encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.ok(snippets.filter(code => code.startsWith("def ")).every(code => code.endsWith("\n    pass")));
});

test("lookup snippets use a real project name and safely quote unusual names", () => {
    const cards = availableCards("sensing", false, '고양이 "하나"');
    const code = cards.find(card => card.title === "다른 캐릭터의 위치").rows[0].code;
    assert.equal(code, '위치_구하기("고양이 \\"하나\\"")');
});

test("copy operation resolves only after the clipboard accepts the exact source", async () => {
    let received;
    const source = "def 시작():\n    pass";
    await copyCode(source, { async writeText(value) { received = value; } });
    assert.equal(received, source);
    await assert.rejects(copyCode(source, undefined), /복사 기능/);
    await assert.rejects(copyCode(source, { async writeText() { throw new Error("denied"); } }), /denied/);
});

test("preview reflects configured actor order, scale, heading and visibility before a run", () => {
    const scene = previewScene({
        background: { kind: "city" },
        actors: [
            { name: "자동차", kind: "car", x: -100, y: 20, heading: 90, scale: 2, visible: false },
            { name: "고양이", kind: "cat" }
        ]
    });
    assert.equal(scene.background, "city");
    assert.deepEqual(scene.sprites.map(sprite => sprite.label), ["자동차", "고양이"]);
    assert.equal(scene.sprites[0].width, 240);
    assert.equal(scene.sprites[0].heading, 90);
    assert.equal(scene.sprites[0].visible, false);
    assert.equal(scene.sprites[1].x, 0);
});

test("renderer wraps speech inside stage edges and omits hidden actor speech", async () => {
    const textCalls = [];
    const fakeContext = () => new Proxy({
        measureText: text => ({ width: [...text].length * 10 }),
        fillText: (text, x, y) => textCalls.push({ text, x, y }),
        createLinearGradient: () => ({ addColorStop() {} })
    }, { get(target, name) { return name in target ? target[name] : () => {}; } });
    const context = vm.createContext({
        window: {}, Path2D: class {},
        document: { createElement: () => ({ getContext: fakeContext }) }
    });
    const source = await readFile(new URL("../src/BlackThunder.BlackPy/wwwroot/scene.js", import.meta.url), "utf8");
    vm.runInContext(source, context);
    context.window.BlackPySceneRenderer.draw(fakeContext(), {
        background: "plain",
        sprites: [
            { x: 400, y: 300, width: 80, height: 80, heading: 0, kind: "cat", visible: true,
                speech: "가".repeat(60), label: "" },
            { x: 0, y: 0, width: 80, height: 80, heading: 0, kind: "cat", visible: false,
                speech: "숨긴 말", label: "" }
        ]
    });
    const speech = textCalls.filter(call => call.text.startsWith("가"));
    assert.equal(speech.length, 3);
    assert.equal(speech.map(call => call.text).join(""), "가".repeat(60));
    assert.ok(speech.every(call => call.x >= 0 && call.x + call.text.length * 10 <= 800 && call.y > 0));
    assert.ok(textCalls.every(call => call.text !== "숨긴 말"));
});
