import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TestHost, defaultProject, pause } from "./TestHost.mjs";

const host = new TestHost();
before(async () => { await host.open(); });
beforeEach(async () => { await host.stop(); });
after(async () => { await host.close(); });

function physicsProject() {
    const project = defaultProject();
    Object.assign(project.actors[0], { kind: "ball", scale: 0.5, x: 0, y: 100, physics: "물리", mass: 1 });
    project.actors[1].x = 1000;
    return project;
}

test("start-only physics stays alive, falls to the boundary and does not rotate", async () => {
    await host.write('def 시작():\n    방향 = 37\n    힘_작용(0, 2)\n', "", "", physicsProject());
    await host.run();
    await host.wait(() => host.sprite()?.x > 30 && host.sprite()?.y < 80, "impulse and gravity");
    const halfHeight = 16 * (Math.cos(37 * Math.PI / 180) + Math.sin(37 * Math.PI / 180));
    const floorY = -300 + halfHeight;
    await host.wait(() => Math.abs(host.sprite()?.y - floorY) < 1, "rotated box on stage floor");
    assert.equal(host.state.status, "running");
    assert.equal(host.sprite().heading, 37);
    assert.ok(host.sprite().x <= 384.8);
    await pause(150);
    assert.ok(Math.abs(host.sprite().y - floorY) < 1);
});

test("movement waits for the resolved wall position before the next student statement", async () => {
    const project = physicsProject();
    Object.assign(project.actors[0], { x: -100, y: 0, speed: 10 });
    Object.assign(project.actors[1], { x: 100, y: 0, scale: 2 });
    await host.write('def 시작():\n    앞으로(400)\n    print("BLOCKED", 위치[0])\n', "", "", project);
    await host.run();
    await host.wait(() => host.text().includes("BLOCKED"), "blocked movement completes");
    const match = host.text().match(/^BLOCKED (\S+)$/m);
    assert.ok(match, host.text());
    const x = Number(match[1]);
    // Wall left edge -20, ball half width 16.
    assert.ok(x > -38 && x < -34, `resolved x: ${x}`);
    assert.equal(host.state.status, "running");
});

test("renaming keeps contact identity and lookup uses the new name", async () => {
    const project = defaultProject();
    project.actors[0].x = 0;
    project.actors[1].x = 0;
    await host.write('이름_정하기("새 고양이")\n' +
        'def 닿았을_때(목록):\n    print("CONTACT", 닿은_객체_리스트)\n' +
        'def 키_클릭(키):\n    가시성_설정(False)\n',
    'def 닿았을_때(목록):\n    print("LOOKUP", 목록, 위치_구하기("새 고양이"))\n' +
        'def 닿는_중_종료(목록):\n    print("EXIT", 목록, 닿은_객체_리스트)\n', "", project);
    await host.run();
    await host.wait(() => host.text().includes("LOOKUP"), "renamed contact");
    assert.match(host.text(), /CONTACT \['자동차'\]/);
    assert.match(host.text(), /LOOKUP \['새 고양이'\] \(0(?:\.0)?, 0(?:\.0)?\)/);
    assert.equal(host.sprite("새 고양이").id, "actor-1");
    await host.input("keydown", { key: "스페이스" });
    await host.input("keyup", { key: "스페이스" });
    await host.wait(() => host.text().includes("EXIT"), "hidden contact exit");
    assert.match(host.text(), /EXIT \['새 고양이'\] \[\]/);
});

test("restart discards the old physics world and rejects its commands", async () => {
    await host.write('def 시작():\n    힘_작용(0, 2)\n', "", "", physicsProject());
    await host.run();
    await host.wait(() => host.sprite()?.x > 80, "first run moves");
    const oldRun = host.state.runId;
    await host.run("/api/restart");
    const rejected = await host.request("/api/physics/step", {
        runId: oldRun, deltaTime: 0, actors: [], commands: []
    });
    assert.equal(rejected.status, 409);
    await host.wait(() => host.sprite()?.x > 0 && host.sprite()?.x < 70, "fresh physics state");
    assert.equal(host.state.status, "running");
});
