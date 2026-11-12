import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { TestHost, pause, toolRoot } from "./TestHost.mjs";

async function sample(name, check) {
    const workspace = await mkdtemp(path.join(tmpdir(), "BlackPy 샘플 "));
    await cp(path.join(toolRoot, "samples", name), workspace, { recursive: true });
    const host = new TestHost();

    try {
        await host.open({ workspace });
        await host.run();
        await host.wait(() => host.state?.scene?.active, "sample scene");
        await check(host);
        assert.notEqual(host.state.status, "error", host.text());
    } finally {
        await host.close();
    }
}

test("movement sample completes its square at the initial position", async () => {
    await sample("01-movement", async host => {
        await host.done();
        assert.equal(host.state.status, "completed", host.text());
        const cat = host.sprite();
        assert.ok(Math.abs(cat.x + 160) < 0.01);
        assert.ok(Math.abs(cat.y + 80) < 0.01);
        assert.ok(Math.min(Math.abs(cat.heading), Math.abs(cat.heading - 360)) < 0.01);
        assert.equal(cat.speech, "다시 제자리예요!");
        assert.match(host.text(), /네모 걷기 완료:/);
        assert.ok(host.history.some(scene => scene.sprites[0].x > -10));
        assert.ok(host.history.some(scene => scene.sprites[0].y > 70));
    });
});

test("keyboard sample moves in four directions, releases, and resets with space", async () => {
    await sample("02-keyboard", async host => {
        for (const [key, axis, sign] of [
            ["오른쪽", "x", 1], ["위", "y", 1], ["왼쪽", "x", -1], ["아래", "y", -1]
        ]) {
            const start = host.sprite()[axis];
            await host.input("keydown", { key });
            await host.wait(() => (host.sprite()[axis] - start) * sign > 25, "held " + key);
            await host.input("keyup", { key });
            await host.wait(() => host.sprite().speech === key + " 뗌" &&
                host.text().includes("뗌: " + key), "released " + key);
            const stopped = host.sprite()[axis];
            await pause(100);
            assert.equal(host.sprite()[axis], stopped);
            assert.equal(host.text().split("누름: " + key).length - 1, 1);
        }

        await host.input("keydown", { key: "스페이스" });
        await host.input("keyup", { key: "스페이스" });
        await host.wait(() => host.sprite().speech === "스페이스 뗌" &&
            host.text().includes("뗌: 스페이스"), "space reset");
        assert.equal(host.sprite().x, 0);
        assert.equal(host.sprite().y, 0);
    });
});

test("click sample grows and rotates until release, with separate background input", async () => {
    await sample("03-click", async host => {
        const ball = () => host.sprite("공");
        await host.input("pointerdown", { button: "왼쪽" });
        await host.wait(() => ball().width === 96 && ball().heading > 20, "held ball");
        await host.input("pointermove", { x: 350, y: 250 });
        await host.input("pointerup", { button: "왼쪽", x: 350, y: 250 });
        await host.wait(() => ball().speech === "놓았어요!", "captured release");
        assert.equal(ball().width, 64);
        assert.match(host.text(), /공 누름/);
        assert.match(host.text(), /공 뗌/);
        assert.doesNotMatch(host.text(), /배경 클릭/);
        const heading = ball().heading;
        await pause(100);
        assert.equal(ball().heading, heading);

        await host.input("pointerdown", { button: "왼쪽", x: 350, y: 250 });
        await host.input("pointerup", { button: "왼쪽", x: 350, y: 250 });
        await host.wait(() => host.state.scene.message === "배경의 빈 곳을 눌렀어요!", "background press");
    });
});

test("broadcast sample includes its sender and moves both actors together", async () => {
    await sample("04-broadcast", async host => {
        await host.input("pointerdown", { button: "왼쪽", x: 0, y: 200 });
        await host.input("pointerup", { button: "왼쪽", x: 0, y: 200 });
        await host.wait(() => host.sprite().speech === "고양이가 제자리로 돌아왔어요!" &&
            host.sprite("자동차").speech === "자동차가 제자리로 돌아왔어요!", "broadcast round trip");
        assert.equal(host.state.scene.message, "방송한 배경도 출발 신호를 받았어요!");
        assert.ok(Math.abs(host.sprite().x + 180) < 0.01);
        assert.ok(Math.abs(host.sprite("자동차").x - 180) < 0.01);
        assert.ok(host.history.some(scene =>
            scene.sprites.find(actor => actor.label === "고양이").x > -140 &&
            scene.sprites.find(actor => actor.label === "자동차").x < 140), "concurrent movement");

        await host.input("keydown", { key: "스페이스" });
        await host.input("keyup", { key: "스페이스" });
        await host.wait(() => host.sprite().speech === "야옹! 고양이도 출발!", "second movement starts");
        await host.wait(() => host.text().split("고양이: 출발!").length === 3, "second broadcast");
        await host.wait(() => host.sprite().speech === "고양이가 제자리로 돌아왔어요!" &&
            host.sprite("자동차").speech === "자동차가 제자리로 돌아왔어요!", "second round trip");

        for (const message of ["배경: 내가 보낸 출발 신호를 받았어요.", "고양이: 출발!", "자동차: 출발!"]) {
            assert.equal(host.text().split(message).length - 1, 2);
        }
    });
});

test("contact sample reports enter and exit once without flooding the log while held", async () => {
    await sample("05-contact", async host => {
        const star = () => host.sprite("별");
        await host.input("keydown", { key: "오른쪽" });
        await host.wait(() => star().speech === "고양이와 닿는 중이에요!", "contact stay");
        await host.input("keyup", { key: "오른쪽" });
        await pause(200);
        assert.equal(host.text().split("닿았을 때:").length - 1, 1);
        assert.match(host.text(), /닿았을 때: \['고양이'\]/);
        assert.doesNotMatch(host.text(), /떨어졌을 때:/);
        assert.equal(star().speech, "고양이와 닿는 중이에요!");
        assert.equal(star().x, 100);
        assert.equal(star().y, 0);

        await host.input("keydown", { key: "왼쪽" });
        await host.wait(() => star().speech === "고양이와 떨어졌어요!", "contact exit");
        await host.input("keyup", { key: "왼쪽" });
        await pause(100);
        assert.equal(host.text().split("닿았을 때:").length - 1, 1);
        assert.equal(host.text().split("떨어졌을 때:").length - 1, 1);
        assert.match(host.text(), /떨어졌을 때: \['고양이'\]/);
    });
});

test("physics sample settles on its platform and jumps on a single key press", async () => {
    await sample("06-physics", async host => {
        const ball = () => host.sprite("공");
        await host.wait(() => Math.abs(ball().y + 138) < 1, "ball rests on platform");
        assert.equal(host.state.status, "running");
        assert.equal(host.sprite("발판").y, -180);
        const direction = ball().heading;
        await host.input("keydown", { key: "스페이스" });
        await host.input("keyup", { key: "스페이스" });
        await host.wait(() => ball().y > -90, "ball jumps");
        assert.equal(ball().heading, direction);
        await host.wait(() => Math.abs(ball().y + 138) < 1, "ball returns to platform");
    });
});
