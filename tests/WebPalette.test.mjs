import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { categories, availableCards, copyCode, previewScene } =
    require("../src/BlackThunder.BlackPy/wwwroot/palette.js");

function allCards() {
    return categories.flatMap(category => availableCards(category.id));
}

test("one common palette exposes all commands and marks actor-only cards", () => {
    const cards = allCards();
    const codes = cards.flatMap(card => card.rows.map(row => row.code));
    assert.ok(codes.includes("def 자신_클릭():\n    pass"));
    assert.ok(codes.includes("def 키_클릭_끝(누른_키):\n    pass"));
    assert.ok(codes.includes("def 방송_받기(신호_이름):\n    pass"));
    assert.ok(codes.includes("def 닿는_중_종료(이름_리스트):\n    pass"));
    assert.ok(["위치", "방향", "속도", "크기", "가시성", "속도_변경(1)", "가시성_설정(True)",
        "크기_정하기(1)", "크기_바꾸기(2)"].every(code => codes.includes(code)));
    assert.ok(codes.every(code => !/^(위치|방향|속도|크기|가시성|배경|물리|무게)\s*=/.test(code)));
    assert.equal(new Set(codes).size, codes.length);
    for (const code of ["앞으로(10)", '이름_정하기("새이름")', "정지()", "가시성_설정(True)"]) {
        assert.equal(cards.find(card => card.rows.some(row => row.code === code)).actor, true);
    }
    for (const code of ["이름", "기다리기(1)", '말하기("안녕!")', '위치_구하기("고양이")']) {
        assert.ok(!cards.find(card => card.rows.some(row => row.code === code)).actor);
    }
});

test("physics modes, actions and contacts have one category while variables and functions stay deferred", () => {
    assert.deepEqual(categories.map(category => category.label), ["이벤트", "움직임", "물리", "생김새", "계산", "주변"]);
    const physics = availableCards("physics").flatMap(card => card.rows);
    assert.deepEqual(physics.slice(0, 2).map(row => [row.code, row.kind]), [
        ["물리", "value"], ['물리_설정("물리")', "command"]
    ]);
    assert.ok(["무게", "무게_설정(10)", "힘_작용(90, 10)", "정지()", "닿은_객체_리스트"]
        .every(code => physics.some(row => row.code === code)));
    assert.equal(physics.filter(row => row.kind === "event").length, 3);
    assert.ok(availableCards("sensing").every(card => !card.title.startsWith("충돌")));
    const motion = availableCards("motion").flatMap(card => card.rows.map(row => row.code));
    assert.ok(["왼쪽_돌기(10)", "오른쪽_돌기(10)", "바라보기(0)", "바라보기(10, 0)"].every(code => motion.includes(code)));
    assert.equal(motion.at(-1), "기다리기(1)");
    assert.ok(availableCards("events").every(card => !card.rows.some(row => row.code === "기다리기(1)")));
});

test("every copyable row is valid Python including complete event bodies", () => {
    const snippets = allCards().flatMap(card => card.rows.map(row => row.code));
    const result = spawnSync(process.env.PYTHON_EXE || "python", ["-c",
        "import ast,json,sys; [ast.parse(source) for source in json.loads(sys.stdin.buffer.read().decode('utf-8'))]"], {
        input: JSON.stringify(snippets), encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.ok(snippets.filter(code => code.startsWith("def ")).every(code => code.endsWith("\n    pass")));
});

test("flip is an actor command immediately after right turn and copies the horizontal example", async () => {
    const motion = availableCards("motion");
    const index = motion.findIndex(card => card.title === "오른쪽으로 돌기");
    const flip = motion[index + 1];
    assert.equal(flip.title, "뒤집기");
    assert.equal(flip.actor, true);
    let copied;
    await copyCode(flip.rows[0].code, { async writeText(value) { copied = value; } });
    assert.equal(copied, '뒤집기("가로")');
});

test("lookup snippets use a real project name and safely quote unusual names", () => {
    const cards = availableCards("sensing", '고양이 "하나"');
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
    assert.equal(scene.sprites[1].flipHorizontal, false);
    assert.equal(scene.sprites[1].flipVertical, false);
});

test("renderer mirrors each local artwork axis without mirroring labels or speech", async () => {
    const scales = [];
    const textCalls = [];
    let transforms = [];
    const stack = [];
    const fakeContext = () => new Proxy({
        measureText: text => ({ width: [...text].length * 10 }),
        createLinearGradient: () => ({ addColorStop() {} })
    }, { get(target, name) { return name in target ? target[name] : () => {}; } });
    const drawing = fakeContext();
    Object.assign(drawing, {
        save() { stack.push([...transforms]); },
        restore() { transforms = stack.pop(); },
        translate(x, y) { transforms.push(["translate", x, y]); },
        rotate(angle) { transforms.push(["rotate", angle]); },
        scale(x, y) { scales.push([x, y]); transforms.push(["scale", x, y]); },
        fillText(text) { textCalls.push({ text, transforms: [...transforms] }); }
    });
    const context = vm.createContext({
        window: {}, Path2D: class {},
        document: { createElement: () => ({ getContext: fakeContext }) }
    });
    const source = await readFile(new URL("../src/BlackThunder.BlackPy/wwwroot/scene.js", import.meta.url), "utf8");
    vm.runInContext(source, context);
    for (const [horizontal, vertical, expected] of [
        [false, false, [0.8, 0.6]], [true, false, [-0.8, 0.6]],
        [false, true, [0.8, -0.6]], [true, true, [-0.8, -0.6]]
    ]) {
        scales.length = 0;
        textCalls.length = 0;
        context.window.BlackPySceneRenderer.draw(drawing, {
            background: "plain",
            sprites: [{ x: 20, y: 30, width: 80, height: 60, heading: 90, kind: "cat", visible: true,
                label: "고양이", speech: "안녕!", flipHorizontal: horizontal, flipVertical: vertical }]
        });
        assert.deepEqual(scales[0], expected);
        assert.deepEqual(textCalls.map(call => call.text), ["고양이", "안녕!"]);
        assert.ok(textCalls.every(call => call.transforms.length === 0));
        assert.equal(stack.length, 0);
    }
});

test("renderer draws project images in place of the matching background and actor drawings", async () => {
    const drawn = [];
    const fakeContext = () => new Proxy({
        measureText: text => ({ width: [...text].length * 10 }),
        createLinearGradient: () => ({ addColorStop() {} }),
        drawImage: (image, ...box) => drawn.push({ image, box })
    }, { get(target, name) { return name in target ? target[name] : () => {}; } });
    const context = vm.createContext({
        window: {}, Path2D: class {},
        document: { createElement: () => ({ getContext: fakeContext }) }
    });
    const source = await readFile(new URL("../src/BlackThunder.BlackPy/wwwroot/scene.js", import.meta.url), "utf8");
    vm.runInContext(source, context);
    const stage = { name: "stage" };
    const rocket = { name: "rocket" };
    const sprites = [
        { id: "actor-1", x: 0, y: 0, width: 90, height: 64, heading: 90, kind: "rocket", visible: true, label: "", speech: "" },
        { id: "actor-2", x: 50, y: 0, width: 86, height: 96, heading: 0, kind: "cat", visible: true, label: "", speech: "" }
    ];
    const images = { backgroundKind: "plain", background: stage, actors: new Map([["actor-1", rocket]]) };

    context.window.BlackPySceneRenderer.draw(fakeContext(), { background: "plain", sprites }, images);
    assert.equal(drawn[0].image, stage);
    assert.deepEqual(drawn[0].box, [0, 0, 800, 600]);
    assert.deepEqual(drawn.filter(call => call.image === rocket).map(call => call.box), [[-50, -50, 100, 100]]);
    assert.equal(drawn.length, 2);

    drawn.length = 0;
    context.window.BlackPySceneRenderer.draw(fakeContext(), { background: "city", sprites }, images);
    assert.notEqual(drawn[0].image, stage);
    assert.ok(drawn.some(call => call.image === rocket));

    drawn.length = 0;
    context.window.BlackPySceneRenderer.draw(fakeContext(), { background: "plain", sprites });
    assert.ok(drawn.every(call => call.image !== stage && call.image !== rocket));
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
