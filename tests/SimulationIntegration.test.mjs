import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { after, before, beforeEach, test } from "node:test";
import { TestHost, defaultProject, pause } from "./TestHost.mjs";

const host = new TestHost();
before(async () => { await host.open(); });
beforeEach(async () => { await host.stop(); });
after(async () => { await host.close(); });

function observeScenes() {
    const frames = [];
    const receive = ({ data }) => {
        const packet = JSON.parse(data);
        if (packet.runId === host.state.runId && packet.status === "running" && packet.scene?.active) {
            frames.push({ time: performance.now(), scene: packet.scene });
        }
    };
    host.socket.addEventListener("message", receive);
    return { frames, close: () => host.socket.removeEventListener("message", receive) };
}

function blockingBackground(seconds, delay = 0.15) {
    return `import time\ndef 시작():\n    기다리기(${delay})\n` +
        `    print("NATIVE_BLOCK_BEGIN", flush=True)\n    time.sleep(${seconds})\n` +
        '    print("NATIVE_BLOCK_END", flush=True)\n';
}

test("gravity and an ordinary move advance while Python is blocked in native code", async () => {
    const project = defaultProject();
    Object.assign(project.actors[0], { x: -250, y: 0, physics: "없음" });
    Object.assign(project.actors[1], { kind: "ball", x: 200, y: 180, scale: 0.5, physics: "물리" });
    await host.write('def 시작():\n    앞으로(200)\n    print("MOVE_DONE", 위치[0])\n', "",
        blockingBackground(0.9), project);
    await host.run();
    await host.wait(() => host.text().includes("NATIVE_BLOCK_BEGIN"), "native block begins");
    const initial = { x: host.sprite().x, y: host.sprite("자동차").y };
    const observation = observeScenes();
    try {
        await pause(450);
        assert.doesNotMatch(host.text(), /NATIVE_BLOCK_END/);
        assert.ok(host.sprite().x > initial.x + 65, "The ordinary move must continue without Python polling");
        assert.ok(host.sprite("자동차").y < initial.y - 70, "Gravity must continue without Python polling");
        assert.ok(observation.frames.length >= 12, `Only ${observation.frames.length} independent scenes arrived`);
        const positions = new Set(observation.frames.map(frame => frame.scene.sprites[0].x));
        assert.ok(positions.size >= 12, "Received frames must contain new simulated positions");
    } finally {
        observation.close();
    }
    await host.wait(() => host.text().includes("MOVE_DONE"), "ordinary move completion reaches Python");
    const completion = host.text().match(/^MOVE_DONE (\S+)$/m);
    assert.ok(completion, host.text());
    assert.ok(Math.abs(Number(completion[1]) + 50) < 1e-9, host.text());
});

test("held movement survives blocked Python, releases immediately and rejects an old press generation", async () => {
    const project = defaultProject();
    Object.assign(project.actors[0], { x: -250, physics: "없음" });
    const cat = '첫번째 = True\ndef 키_클릭_중(키):\n    global 첫번째\n' +
        '    if 키 == "오른쪽":\n        앞으로(120)\n        if 첫번째:\n' +
        '            첫번째 = False\n            기다리기(0.65)\n            앞으로(1000)\n' +
        '            print("OLD_CALLBACK_FINISHED", flush=True)\n';
    const background = 'import time\ndef 키_클릭(키):\n    if 키 == "스페이스":\n' +
        '        print("NATIVE_BLOCK_BEGIN", flush=True)\n        time.sleep(0.9)\n' +
        '        print("NATIVE_BLOCK_END", flush=True)\n';
    await host.write(cat, "", background, project);
    await host.run();
    await host.wait(() => host.sprite(), "initial scene");
    await host.input("keydown", { key: "오른쪽" });
    await host.wait(() => host.sprite().x > -235, "held movement is installed");
    await host.input("keydown", { key: "스페이스" });
    await host.input("keyup", { key: "스페이스" });
    await host.wait(() => host.text().includes("NATIVE_BLOCK_BEGIN"), "native block begins");
    const movingX = host.sprite().x;
    await pause(200);
    assert.ok(host.sprite().x > movingX + 15, "An installed held rate must survive the Python stall");
    const released = await host.request("/api/input", {
        runId: host.state.runId, kind: "keyup", key: "오른쪽", x: 0, y: 0
    });
    assert.equal(released.status, 200, JSON.stringify(released.body));
    const releasedState = await host.request("/api/state");
    assert.equal(releasedState.status, 200);
    const releaseX = releasedState.body.scene.sprites.find(sprite => sprite.id === "actor-1").x;
    await pause(150);
    assert.doesNotMatch(host.text(), /NATIVE_BLOCK_END/);
    assert.ok(Math.abs(host.sprite().x - releaseX) < 0.001, "Key release must not wait for Python");
    await host.input("keydown", { key: "오른쪽" });
    await pause(100);
    assert.ok(Math.abs(host.sprite().x - releaseX) < 0.001, "A new press cannot reuse the old rate");
    await host.wait(() => host.text().includes("OLD_CALLBACK_FINISHED"), "old callback finishes normally");
    await host.wait(() => host.sprite().x > releaseX + 3, "new generation installs its own rate");
    const resumedX = host.sprite().x;
    await pause(180);
    assert.ok(host.sprite().x - resumedX > 10 && host.sprite().x - resumedX < 35,
        "A late old-generation command must not replace the new 120 units/second rate");
    await host.input("keyup", { key: "오른쪽" });
});

test("a slow Python exchange loop does not set the C# scene update rate", async () => {
    const probe = `
import asyncio
import time
original_exchange = script_runtime.remote_exchange
async def slow_exchange(scene, actors, commands, ready, ack, contact_ack):
    await asyncio.to_thread(time.sleep, 0.05)
    result = await original_exchange(scene, actors, commands, ready, ack, contact_ack)
    if ready:
        print("PYTHON_EXCHANGE", flush=True)
    return result
script_runtime.remote_exchange = slow_exchange
`;
    const project = defaultProject();
    Object.assign(project.actors[0], { physics: "없음", x: -250 });
    await host.write('def 시작():\n    앞으로(500)\n\ndef 키_클릭(키):\n    pass\n', "",
        `exec(${JSON.stringify(probe)}, {"script_runtime": 말하기.__self__.runtime})\n`, project);
    await host.run();
    await host.wait(() => host.sprite()?.x > -240, "slow Python starts the independent move");
    const initialPolls = host.text().match(/PYTHON_EXCHANGE/g)?.length || 0;
    const observation = observeScenes();
    try {
        await pause(800);
        const polls = (host.text().match(/PYTHON_EXCHANGE/g)?.length || 0) - initialPolls;
        assert.ok(polls >= 5 && polls <= 20, `Expected a deliberately slow Python loop, got ${polls} exchanges`);
        assert.ok(observation.frames.length >= 28, `Only ${observation.frames.length} C# scenes arrived`);
        assert.ok(observation.frames.length > polls * 1.7, "Scene production must be independent of Python polling");
        const positions = new Set(observation.frames.map(frame => frame.scene.sprites[0].x));
        assert.ok(positions.size >= 28, "C# must simulate between Python exchanges");
    } finally {
        observation.close();
    }
});

test("contact enter and exit are retained when both occur during a Python stall", async () => {
    const project = defaultProject();
    for (const actor of project.actors) Object.assign(actor, { kind: "ball", scale: 0.2, y: 0 });
    project.actors[0].x = -200;
    project.actors[1].x = 0;
    const cat = 'def 시작():\n    앞으로(400)\n' +
        '\ndef 닿았을_때(목록):\n    print("CONTACT_ENTER", 목록, flush=True)\n' +
        '\ndef 닿는_중_종료(목록):\n    print("CONTACT_EXIT", 목록, flush=True)\n';
    await host.write(cat, "", blockingBackground(1.4, 0.3), project);
    await host.run();
    await host.wait(() => host.text().includes("NATIVE_BLOCK_BEGIN"), "native block begins");
    await pause(1050);
    assert.doesNotMatch(host.text(), /NATIVE_BLOCK_END|CONTACT_ENTER|CONTACT_EXIT/);
    assert.ok(host.sprite().x > 30, "The moving actor must cross the other actor during the stall");
    await host.wait(() => host.text().includes("CONTACT_EXIT"), "both queued contact transitions reach Python");
    const text = host.text();
    assert.match(text, /CONTACT_ENTER \['자동차'\]/);
    assert.match(text, /CONTACT_EXIT \['자동차'\]/);
    assert.equal(text.match(/CONTACT_ENTER/g)?.length, 1);
    assert.equal(text.match(/CONTACT_EXIT/g)?.length, 1);
    assert.ok(text.indexOf("CONTACT_ENTER") < text.indexOf("CONTACT_EXIT"));
});

function exchangePayload(runId, sequence, project) {
    const sprites = project.actors.map((actor, index) => ({
        id: `actor-${index + 1}`, kind: "ball", label: actor.name,
        x: actor.x, y: actor.y, width: 32, height: 32, heading: actor.heading,
        visible: true, color: "#e8a15e", speech: ""
    }));
    return {
        runId, sequence, ready: true, scene: { active: true, background: "plain", sprites, message: "" },
        actors: sprites.map((sprite, index) => ({
            id: sprite.id, x: sprite.x, y: sprite.y, width: sprite.width, height: sprite.height,
            mode: project.actors[index].physics, mass: 1, visible: true
        })),
        commands: [], acknowledgedCompletions: [], contactAck: 0
    };
}

test("exchange bursts respect time and scene caps, and old runs cannot drive simulation", async () => {
    const project = defaultProject();
    Object.assign(project.actors[0], { kind: "ball", scale: 0.5, x: 0, y: 200, physics: "물리" });
    Object.assign(project.actors[1], { kind: "ball", scale: 0.5, x: 1000, y: 0, physics: "없음" });
    // Block initialization before its first exchange; this fixture alone owns the protocol sequence.
    await host.write("", "", 'import time\nprint("PASSIVE_PYTHON", flush=True)\ntime.sleep(4)\n', project);
    await host.run();
    await host.wait(() => host.text().includes("PASSIVE_PYTHON"), "passive Python fixture");
    const runId = host.state.runId;
    const first = await host.request("/api/simulation/exchange", exchangePayload(runId, 1, project));
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const observation = observeScenes();
    let last = first;
    const begin = performance.now();
    try {
        for (let sequence = 2; sequence <= 61; sequence++) {
            last = await host.request("/api/simulation/exchange", exchangePayload(runId, sequence, project));
            assert.equal(last.status, 200, JSON.stringify(last.body));
        }
        const elapsed = (performance.now() - begin) / 1000;
        assert.ok(last.body.tick - first.body.tick <= Math.ceil(elapsed * 60) + 2,
            "Request count must not advance simulation ticks");
        assert.ok(last.body.elapsed - first.body.elapsed <= elapsed + 0.05,
            "Request count must not advance simulation time");
        assert.ok(observation.frames.length <= Math.ceil(elapsed * 60) + 3,
            "An exchange burst must not produce one WebSocket scene per request");
    } finally {
        observation.close();
    }
    const bypass = await host.request("/api/physics/step", {
        runId, deltaTime: 10, actors: [], commands: []
    });
    assert.equal(bypass.status, 400, JSON.stringify(bypass.body));
    const repeated = exchangePayload(runId, 61, project);
    repeated.commands.push({ id: "actor-1", kind: "teleport", x: 300, y: 250 });
    const duplicate = await host.request("/api/simulation/exchange", repeated);
    assert.equal(duplicate.status, 200, JSON.stringify(duplicate.body));
    assert.ok(Math.abs(duplicate.body.actors[0].x) < 0.001, "An acknowledged sequence must not execute again");
    const skipped = await host.request("/api/simulation/exchange", exchangePayload(runId, 63, project));
    assert.equal(skipped.status, 400, JSON.stringify(skipped.body));
    await host.run("/api/restart");
    const stale = await host.request("/api/simulation/exchange", exchangePayload(runId, 62, project));
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    await host.wait(() => host.text().includes("PASSIVE_PYTHON"), "restarted passive Python fixture");
    const fresh = await host.request("/api/simulation/exchange", exchangePayload(host.state.runId, 1, project));
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    assert.equal(fresh.body.tick, 0);
    assert.ok(Math.abs(fresh.body.actors[0].y - 200) < 0.001, "Restart must create a fresh simulation world");
});
