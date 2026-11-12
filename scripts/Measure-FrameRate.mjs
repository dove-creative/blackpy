import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { TestHost, distributionRoot, pause, toolRoot } from "../tests/TestHost.mjs";

const seconds = Number(process.argv[2] || 15);
assert.ok(Number.isFinite(seconds) && seconds >= 5 && seconds <= 120, "Measure 5 to 120 seconds.");
const mode = process.argv[3] || "normal";
assert.ok(["normal", "slow"].includes(mode), "Use normal or slow Python polling mode.");
const exchangeDelay = mode === "slow" ? 0.05 : 0;
const warmupSeconds = 3;
const output = path.join(toolRoot, "artifacts", "test-results", "frame-rate-" + Date.now());
const workspace = path.join(output, "project");
const profileFile = path.join(output, "python-profile.json");
await mkdir(output, { recursive: true });
await cp(path.join(toolRoot, "samples", "06-physics"), workspace, { recursive: true });

// Instrument only the temporary project. No source or installed runtime is replaced.
const probe = `
import asyncio
import _blackpy_runtime as runtime_module
import json
from pathlib import Path
import sys
import time
profile_path = Path(${JSON.stringify(profileFile.replaceAll("\\", "/"))})
profile = {"frames": [], "requests": {}, "python": sys.version}
last_flush = 0
original_request = runtime_module.HttpTransport.request
original_exchange = script_runtime.remote_exchange
def timed_request(self, connection, method, endpoint, payload=None):
    start = time.perf_counter()
    try:
        return original_request(self, connection, method, endpoint, payload)
    finally:
        finished = time.perf_counter()
        profile["requests"].setdefault(endpoint.split("?")[0], []).append(
            [finished, (finished - start) * 1000])
async def timed_exchange(scene, actors, commands, ready, ack, contact_ack):
    global last_flush
    if ${exchangeDelay} > 0:
        await asyncio.to_thread(time.sleep, ${exchangeDelay})
    result = await original_exchange(scene, actors, commands, ready, ack, contact_ack)
    finished = time.perf_counter()
    if ready:
        profile["frames"].append(finished)
    if finished - last_flush >= 0.5:
        temporary = profile_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(profile), encoding="utf-8")
        temporary.replace(profile_path)
        last_flush = finished
    return result
runtime_module.HttpTransport.request = timed_request
script_runtime.remote_exchange = timed_exchange
`;
const background = path.join(workspace, "배경.py");
await writeFile(background, `exec(${JSON.stringify(probe)}, {"script_runtime": 말하기.__self__.runtime})\n` +
    await readFile(background, "utf8"));

function summarize(values) {
    assert.ok(values.length > 1, "Not enough measured frames.");
    const sorted = [...values].sort((first, second) => first - second);
    return {
        count: values.length,
        meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
        p50Ms: sorted[Math.floor(sorted.length * 0.5)],
        p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        maxMs: sorted.at(-1),
        over33ms: values.filter(value => value > 1000 / 30).length
    };
}

function frameSummary(stamps) {
    const result = summarize(stamps.slice(1).map((stamp, index) => stamp - stamps[index]));
    return { ...result, durationMs: stamps.at(-1) - stamps[0], fps: 1000 / result.meanMs };
}

const host = new TestHost();
const packets = [];
let inputLoop;
let inputError;
let running = true;
try {
    await host.open({ workspace });
    host.socket.addEventListener("message", ({ data }) => {
        const packet = JSON.parse(data);
        if (packet.status === "running" && packet.scene?.active) packets.push(performance.now());
    });
    await host.run();
    await host.wait(() => packets.length > 0, "first independent scene");
    const begin = packets[0] + warmupSeconds * 1000;
    const end = begin + seconds * 1000;
    inputLoop = (async () => {
        let turn = 0;
        while (running && performance.now() < end) {
            const key = turn++ % 6 === 5 ? "엔터" : "스페이스";
            await host.input("keydown", { key });
            await host.input("keyup", { key });
            await pause(1000);
        }
    })().catch(error => { inputError = error; running = false; });
    await pause(Math.max(0, end - performance.now()));
    if (inputError) throw inputError;
    assert.equal(host.state.status, "running", host.text());
    let profile;
    await host.wait(async () => {
        try {
            profile = JSON.parse(await readFile(profileFile, "utf8"));
            return profile.frames.length > 1 &&
                profile.frames.at(-1) >= profile.frames[0] + warmupSeconds + seconds;
        } catch (error) {
            if (error.code === "ENOENT") return false;
            throw error;
        }
    }, "complete Python logic measurement window", 3000);
    const pythonBegin = profile.frames[0] + warmupSeconds;
    const pythonEnd = pythonBegin + seconds;
    const measuredRequests = Object.entries(profile.requests).map(([endpoint, values]) => [endpoint,
        values.filter(([stamp]) => stamp >= pythonBegin && stamp <= pythonEnd).map(([, ms]) => ms)]);
    const report = {
        measuredAt: new Date().toISOString(), distribution: distributionRoot, warmupSeconds, seconds,
        mode, exchangeDelayMs: exchangeDelay * 1000,
        environment: { node: process.version, python: profile.python, platform: process.platform, arch: process.arch },
        workload: "06-physics, repeated jump and position reset",
        pythonLogic: {
            ...frameSummary(profile.frames.filter(stamp => stamp >= pythonBegin && stamp <= pythonEnd)
                .map(stamp => stamp * 1000)),
            meaning: "Completed Python simulation exchanges; this is the script logic rate, not the scene frame rate."
        },
        websocket: frameSummary(packets.filter(stamp => stamp >= begin && stamp <= end)),
        requests: Object.fromEntries(measuredRequests.filter(([, values]) => values.length > 1)
            .map(([endpoint, values]) => [endpoint, summarize(values)])),
        limit: "WebSocket scene delivery is measured; browser canvas presentation is not measured."
    };
    report.meets60HzTarget = report.websocket.fps >= 58.5 && report.websocket.fps <= 61.5;
    await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ output, ...report }, null, 2));
    assert.ok(report.meets60HzTarget, "Independent C# scene delivery did not reach the 60 Hz target.");
} finally {
    running = false;
    if (inputLoop) await inputLoop;
    await host.close();
}
