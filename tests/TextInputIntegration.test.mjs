import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TestHost } from "./TestHost.mjs";

const host = new TestHost();
before(async () => { await host.open(); });
beforeEach(async () => { await host.stop(); });
after(async () => { await host.close(); });

async function waitForPrompt(message) {
    await host.wait(() => {
        assert.notEqual(host.state?.status, "error", host.text());
        return host.state?.status === "running" && host.state.scene?.textInput?.message === message;
    }, `input prompt: ${message}`);
    return { runId: host.state.runId, ...host.state.scene.textInput };
}

function submitAnswer(prompt, text) {
    return host.request("/api/input", {
        runId: prompt.runId, kind: "answer", promptId: prompt.id, text
    });
}

async function answer(prompt, text) {
    const response = await submitAnswer(prompt, text);
    assert.equal(response.status, 200, JSON.stringify(response.body));
}

test("top-level input preserves text and supports sequential numeric conversion before start", async () => {
    await host.write('대답 = input("이름은?")\nprint("NAME", repr(대답))\n' +
        '거리 = int(input("거리?"))\n비율 = float(input())\n' +
        'def 시작():\n    print("RESULT", 거리 * 비율)\n    말하기(대답)\n');
    await host.run();
    const name = await waitForPrompt("이름은?");
    assert.equal(name.actor, "고양이");
    assert.doesNotMatch(host.text(), /RESULT/);
    await answer(name, "  민수 🐱  ");

    const distance = await waitForPrompt("거리?");
    assert.ok(distance.id > name.id);
    await answer(distance, "12");
    const factor = await waitForPrompt("");
    assert.ok(factor.id > distance.id);
    await answer(factor, "2.5");
    await host.done();
    assert.equal(host.state.status, "completed", host.text());
    assert.match(host.text(), /NAME '  민수 🐱  '/);
    assert.match(host.text(), /RESULT 30\.0/);
    assert.equal(host.sprite().speech, "  민수 🐱  ");
    assert.equal(host.state.scene.textInput, null);
});

test("empty and whitespace answers are returned without trimming", async () => {
    await host.write('def 시작():\n    첫째 = input("빈 답")\n    둘째 = input("공백 답")\n' +
        '    print("EMPTY", len(첫째), 첫째 == "")\n' +
        '    print("SPACES", len(둘째), 둘째 == "   ")\n');
    await host.run();
    await answer(await waitForPrompt("빈 답"), "");
    await answer(await waitForPrompt("공백 답"), "   ");
    await host.done();
    assert.equal(host.state.status, "completed", host.text());
    assert.match(host.text(), /EMPTY 0 True/);
    assert.match(host.text(), /SPACES 3 True/);
});

test("accepted answers echo exact prompt and text before resumed code, including an empty prompt", async () => {
    await host.write('def 시작():\n    print("BEFORE")\n    input("<b>질문</b>: ")\n' +
        '    print("AFTER FIRST")\n    input()\n    print("AFTER SECOND")\n');
    await host.run();
    const first = await waitForPrompt("<b>질문</b>: ");
    await host.wait(() => host.text().includes("BEFORE"), "output before the question");
    assert.equal(host.text(), "BEFORE");
    const firstText = '  <dove> & "입력"  ';
    await answer(first, firstText);
    const second = await waitForPrompt("");
    assert.equal((await submitAnswer(first, "REJECTED DUPLICATE")).status, 409);
    await answer(second, "  빈 질문의 답  ");
    await host.done();
    assert.equal(host.state.status, "completed", host.text());
    assert.deepEqual(host.state.output.map(line => line.text), [
        "BEFORE", "<b>질문</b>: " + firstText, "AFTER FIRST", "  빈 질문의 답  ", "AFTER SECOND"
    ]);
});

test("input in an event helper suspends only its caller while movement and other events continue", async () => {
    await host.write('def 시작():\n    print("READY")\n' +
        '\ndef 질문하기():\n    return input("클릭 질문")\n' +
        '\ndef 자신_클릭():\n    대답 = 질문하기()\n    print("ANSWER", 대답)\n' +
        '\ndef 키_클릭(누른_키):\n    print("KEY", 누른_키)\n',
        'def 키_클릭(누른_키):\n    앞으로(60)\n    print("CAR_MOVED")\n');
    await host.run();
    await host.wait(() => host.text().includes("READY"), "event handlers ready");
    await host.input("pointerdown", { button: "왼쪽", x: -100 });
    await host.input("pointerup", { button: "왼쪽", x: -100 });
    const prompt = await waitForPrompt("클릭 질문");
    assert.equal(prompt.actor, "고양이");
    await host.input("keydown", { key: "스페이스" });
    await host.input("keyup", { key: "스페이스" });
    await host.wait(() => host.text().includes("CAR_MOVED") && host.text().includes("KEY 스페이스"),
        "movement and keyboard event during input");
    assert.equal(host.state.scene.textInput.id, prompt.id);
    assert.doesNotMatch(host.text(), /ANSWER/);
    assert.ok(Math.abs(host.sprite("자동차").x - 90) < 0.01);
    await answer(prompt, "계속");
    await host.wait(() => host.text().includes("ANSWER 계속") && !host.state.scene.textInput,
        "suspended callback resumed");
    assert.equal(host.state.status, "running");
});

test("concurrent actors receive answers in request order without sharing their values", async () => {
    await host.write('def 시작():\n    대답 = input("고양이 질문")\n    print("CAT", 대답)\n',
        'def 시작():\n    대답 = input("자동차 질문")\n    print("CAR", 대답)\n');
    await host.run();
    const first = await waitForPrompt("고양이 질문");
    assert.equal(first.actor, "고양이");
    await answer(first, "고양이 답");
    const second = await waitForPrompt("자동차 질문");
    assert.equal(second.actor, "자동차");
    assert.ok(second.id > first.id);
    assert.equal((await submitAnswer(first, "뒤늦은 답")).status, 409);
    await answer(second, "자동차 답");
    await host.done();
    assert.equal(host.state.status, "completed", host.text());
    assert.match(host.text(), /CAT 고양이 답/);
    assert.match(host.text(), /CAR 자동차 답/);
    assert.doesNotMatch(host.text(), /뒤늦은 답/);
});

test("two browser connections can submit a prompt only once", async () => {
    await host.write('def 시작():\n    대답 = input("한 번만")\n' +
        '    print("ACCEPTED", 대답)\n    기다리기(0.3)\n');
    await host.run();
    const prompt = await waitForPrompt("한 번만");
    const secondBrowser = await host.connect();
    try {
        const responses = await Promise.all([
            submitAnswer(prompt, "첫 탭"), submitAnswer(prompt, "둘째 탭")
        ]);
        assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
        const accepted = responses[0].status === 200 ? "첫 탭" : "둘째 탭";
        await host.done();
        assert.equal(host.state.status, "completed", host.text());
        assert.equal(host.text().match(/^ACCEPTED .+$/gm)?.length, 1);
        assert.ok(host.text().includes("ACCEPTED " + accepted), host.text());
        assert.equal(host.state.output.filter(line => line.text === "한 번만" + accepted).length, 1);
        assert.ok(!host.text().includes(accepted === "첫 탭" ? "둘째 탭" : "첫 탭"), host.text());
    } finally {
        secondBrowser.close();
    }
});

test("stop clears a pending prompt and restart rejects answers from the previous run", async () => {
    await host.write('def 시작():\n    대답 = input("이전 질문")\n    print("OLD", 대답)\n');
    await host.run();
    const previous = await waitForPrompt("이전 질문");
    await host.stop();
    const stopped = (await host.request("/api/state")).body;
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.scene.textInput, null);
    assert.equal((await submitAnswer(previous, "중지 뒤 답")).status, 409);
    assert.doesNotMatch(host.text(), /이전 질문|중지 뒤 답/);

    await host.write('def 시작():\n    대답 = input("새 질문")\n    print("NEW", 대답)\n');
    await host.run("/api/restart");
    const current = await waitForPrompt("새 질문");
    assert.notEqual(current.runId, previous.runId);
    assert.equal((await submitAnswer({ ...current, runId: previous.runId }, "이전 실행 답")).status, 409);
    assert.equal(host.state.scene.textInput.id, current.id);
    await answer(current, "새 답");
    await host.done();
    assert.equal(host.state.status, "completed", host.text());
    assert.match(host.text(), /NEW 새 답/);
    assert.doesNotMatch(host.text(), /OLD|이전 실행 답|중지 뒤 답/);
    assert.equal(host.state.output.filter(line => line.text === "새 질문새 답").length, 1);
    assert.equal(host.state.scene.textInput, null);
});

test("continuous events report a student error instead of queuing input every frame", async () => {
    await host.write('def 시작():\n    print("READY")\n' +
        '\ndef 키_클릭_중(누른_키):\n    input("반복 질문")\n');
    await host.run();
    await host.wait(() => host.text().includes("READY"), "continuous handler ready");
    await host.input("keydown", { key: "오른쪽" });
    await host.done();
    assert.equal(host.state.status, "error");
    assert.match(host.text(), /input|입력/);
    assert.match(host.text(), /유지|중/);
    assert.equal(host.state.scene.textInput, null);
});
