import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TestHost, defaultProject, pause } from "./TestHost.mjs";

const host = new TestHost();
before(async () => { await host.open(); });
beforeEach(async () => { await host.stop(); });
after(async () => { await host.close(); });

test("held keys combine, releasing one keeps the other moving, and release ends new calls", async () => {
    await host.write('def 키_클릭(누른_키):\n    print("DOWN", 누른_키)\n' +
        '\ndef 키_클릭_중(누른_키):\n    if 누른_키 == "오른쪽":\n        방향 = 0\n' +
        '        앞으로(100)\n    elif 누른_키 == "위":\n        방향 = 90\n        앞으로(100)\n' +
        '\ndef 키_클릭_끝(누른_키):\n    print("UP", 누른_키, 위치[0], 위치[1])\n');
    await host.run();
    await host.wait(() => host.sprite(), "initial scene");
    await host.input("keydown", { key: "오른쪽" });
    await host.input("keydown", { key: "위" });
    await host.wait(() => host.sprite().x > -75 && host.sprite().y > 25, "both held keys moved");
    await host.input("keyup", { key: "오른쪽" });
    await host.wait(() => host.text().includes("UP 오른쪽"), "right key release");
    const rightRelease = host.text().match(/^UP 오른쪽 (\S+) (\S+)$/m);
    assert.ok(rightRelease, host.text());
    const releasedX = Number(rightRelease[1]);
    const releasedY = Number(rightRelease[2]);
    await host.wait(() => host.sprite().y > releasedY + 10, "up key continues after right release");
    assert.ok(Math.abs(host.sprite().x - releasedX) < 1e-9, "Released right key must stop horizontal movement");

    await host.input("keyup", { key: "위" });
    await host.wait(() => host.text().includes("UP 위"), "key releases");
    const upRelease = host.text().match(/^UP 위 (\S+) (\S+)$/m);
    assert.ok(upRelease, host.text());
    await host.wait(() => Math.abs(host.sprite().x - Number(upRelease[1])) < 1e-9 &&
        Math.abs(host.sprite().y - Number(upRelease[2])) < 1e-9, "released position reaches the scene");
    const { x, y } = host.sprite();
    await pause(150);
    assert.equal(host.sprite().x, x);
    assert.equal(host.sprite().y, y);
    assert.equal(host.text().match(/DOWN 오른쪽/g)?.length, 1);
});

test("continuous calls overlap, finish after release and do not block ordinary end events", async () => {
    await host.write('def 키_클릭_중(누른_키):\n    print("BEGIN")\n    기다리기(0.3)\n    print("END")\n' +
        '\ndef 키_클릭_끝(누른_키):\n    print("RELEASE")\n');
    await host.run();
    await host.wait(() => host.sprite(), "initial scene");
    await host.input("keydown", { key: "오른쪽" });
    await host.wait(() => (host.text().match(/BEGIN/g)?.length || 0) >= 4, "overlapping callbacks");
    assert.doesNotMatch(host.text(), /END/);
    await host.input("keyup", { key: "오른쪽" });
    await host.wait(() => host.text().includes("RELEASE"), "release event");
    await pause(400);
    const text = host.text();
    assert.equal(text.match(/BEGIN/g)?.length, text.match(/END/g)?.length);
});

test("click ownership stays captured and background only receives empty-space presses", async () => {
    await host.write('def 자신_클릭():\n    print("CAT_DOWN")\n' +
        '\ndef 자신_클릭_중():\n    print("CAT_HELD")\n' +
        '\ndef 자신_클릭_끝():\n    print("CAT_UP")\n', "",
        'def 자신_클릭():\n    print("BACKGROUND")\n');
    await host.run();
    await host.wait(() => host.sprite(), "initial scene");
    await host.input("pointerdown", { button: "왼쪽", x: -100 });
    await host.input("pointermove", { x: 350, y: 250 });
    await pause(80);
    await host.input("pointerup", { button: "왼쪽", x: 350, y: 250 });
    await host.wait(() => host.text().includes("CAT_UP"), "captured release");
    assert.match(host.text(), /CAT_DOWN/);
    assert.match(host.text(), /CAT_HELD/);
    assert.doesNotMatch(host.text(), /BACKGROUND/);
    await host.input("pointerdown", { button: "왼쪽", x: 350, y: 250 });
    await host.input("pointerup", { button: "왼쪽", x: 350, y: 250 });
    await host.wait(() => host.text().includes("BACKGROUND"), "background click");
});

test("same-key ordinary callbacks are suppressed while other keys and signals proceed", async () => {
    await host.write('def 키_클릭(누른_키):\n    print("KEY", 누른_키)\n    앞으로(60)\n' +
        '\ndef 방송_받기(신호_이름):\n    print("SIGNAL", 신호_이름)\n    기다리기(0.3)\n', "",
        'def 자신_클릭():\n    방송하기("A")\n    방송하기("A")\n    방송하기("B")\n');
    await host.run();
    await host.wait(() => host.sprite(), "initial scene");
    for (const key of ["오른쪽", "오른쪽", "위"]) {
        await host.input("keydown", { key });
        await host.input("keyup", { key });
    }
    await host.input("pointerdown", { button: "왼쪽", x: 350, y: 250 });
    await host.input("pointerup", { button: "왼쪽", x: 350, y: 250 });
    await host.wait(() => host.text().includes("SIGNAL B"), "broadcast");
    await pause(400);
    assert.equal(host.text().match(/KEY 오른쪽/g)?.length, 1);
    assert.equal(host.text().match(/KEY 위/g)?.length, 1);
    assert.equal(host.text().match(/SIGNAL A/g)?.length, 1);
    assert.ok(Math.abs(host.sprite().x - 20) < 0.1, "Two relative moves must add 120 units");
});

test("contact enter, every-frame stay and exit carry the matching names", async () => {
    const project = defaultProject();
    project.actors[0].x = 0;
    project.actors[1].x = 0;
    await host.write('def 닿았을_때(이름_리스트):\n    print("ENTER", 이름_리스트)\n' +
        '\ndef 닿는_중(이름_리스트):\n    print("STAY", 이름_리스트)\n' +
        '\ndef 닿는_중_종료(이름_리스트):\n    print("EXIT", 이름_리스트)\n',
        'def 키_클릭(누른_키):\n    가시성 = False\n', "", project);
    await host.run();
    await host.wait(() => (host.text().match(/STAY/g)?.length || 0) >= 3, "contact stay");
    assert.match(host.text(), /ENTER.*자동차/);
    await host.input("keydown", { key: "스페이스" });
    await host.wait(() => host.text().includes("EXIT"), "contact exit");
    assert.match(host.text(), /EXIT.*자동차/);
    assert.equal(host.text().match(/ENTER/g)?.length, 1);
    assert.equal(host.text().match(/EXIT/g)?.length, 1);
});

test("focus reset emits releases and removes held input", async () => {
    await host.write('def 키_클릭_중(누른_키):\n    앞으로(100)\n' +
        '\ndef 키_클릭_끝(누른_키):\n    print("RESET_KEY", 위치[0], 위치[1])\n' +
        '\ndef 자신_클릭_끝():\n    print("RESET_POINTER")\n');
    await host.run();
    await host.wait(() => host.sprite(), "initial scene");
    await host.input("pointerdown", { button: "왼쪽", x: -100 });
    await host.input("keydown", { key: "오른쪽" });
    await pause(100);
    await host.input("reset");
    await host.wait(() => host.text().includes("RESET_KEY") && host.text().includes("RESET_POINTER"), "reset releases");
    const release = host.text().match(/^RESET_KEY (\S+) (\S+)$/m);
    assert.ok(release, host.text());
    await host.wait(() => Math.abs(host.sprite().x - Number(release[1])) < 1e-9 &&
        Math.abs(host.sprite().y - Number(release[2])) < 1e-9, "reset position reaches the scene");
    const { x, y } = host.sprite();
    await pause(150);
    assert.equal(host.sprite().x, x);
    assert.equal(host.sprite().y, y);
});
