import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = readFileSync(path.join(toolRoot, "src/blackpy/__init__.py"), "utf8")
    .match(/^__version__ = "([^"]+)"/m)[1];
export const wheelPath = path.resolve(process.env.BLACKPY_WHEEL ||
    path.join(toolRoot, "artifacts/wheels", `blackpy-${packageVersion}-py3-none-win_amd64.whl`));
export const distributionRoot = path.resolve(process.env.BLACKPY_DISTRIBUTION ||
    path.join(toolRoot, "artifacts", "blackpy"));
export const distributionSupport = existsSync(path.join(distributionRoot, "실습", "_blackpy", "project.json"))
    ? "_blackpy" : "";
export const executable = path.join(distributionRoot, "실습", distributionSupport, "_runtime", "BlackThunder.BlackPy.exe");
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const defaultProject = () => ({
    background: { file: "배경.py", kind: "plain" },
    actors: [
        { name: "고양이", file: "고양이.py", kind: "cat", x: -100, y: 0,
            heading: 0, scale: 1, speed: 1, visible: true },
        { name: "자동차", file: "자동차.py", kind: "car", x: 150, y: 0,
            heading: 180, scale: 1, speed: 1, visible: true }
    ]
});

export class TestHost {
    constructor() { this.state = null; this.output = ""; this.history = []; }

    async open(options = {}) {
        this.workspace = options.workspace || await mkdtemp(path.join(tmpdir(), "BlackPy 새 프로젝트 "));
        this.child = spawn(options.executable || executable,
            options.args || ["--project", this.workspace, "--no-browser"], {
                cwd: options.cwd || tmpdir(), windowsHide: true,
                env: options.env || process.env, stdio: ["pipe", "pipe", "pipe"]
            });
        this.child.on("error", error => { this.output += String(error); });
        this.child.stdout.on("data", bytes => {
            this.output += bytes.toString();
            const match = this.output.match(/PLAYGROUND_URL=(http:\/\/[^\s]+)/);
            if (match) {
                const url = new URL(match[1]);
                this.address = url.origin;
                this.token = new URLSearchParams(url.hash.slice(1)).get("token");
            }
        });
        this.child.stderr.on("data", bytes => { this.output += bytes.toString(); });
        await this.wait(() => this.address, "host startup", 20000);
        this.socket = await this.connect();
        return this;
    }

    async connect() {
        let ready = false;
        const socket = new WebSocket(this.address.replace("http:", "ws:") + "/ws?token=" + this.token);
        socket.addEventListener("message", ({ data }) => {
            const packet = JSON.parse(data);
            this.state = { ...this.state, ...packet };
            if (packet.scene?.active) this.history.push(packet.scene);
            if (this.history.length > 600) this.history.shift();
            if (packet.type === "snapshot") ready = true;
        });
        await once(socket, "open");
        await this.wait(() => ready, "browser snapshot");
        return socket;
    }

    async request(endpoint, data, token = this.token) {
        const get = ["/api/state", "/api/project", "/api/source", "/api/events"].includes(endpoint.split("?")[0]);
        const response = await fetch(this.address + endpoint, {
            method: get ? "GET" : "POST",
            headers: { "Content-Type": "application/json", "X-Playground-Token": token },
            body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000)
        });
        const text = await response.text();
        return { status: response.status, body: text ? JSON.parse(text) : null };
    }

    async write(cat = "", car = "", background = "", project = defaultProject()) {
        await writeFile(path.join(this.workspace, "project.json"), JSON.stringify(project), "utf8");
        for (const [file, source] of [["고양이.py", cat], ["자동차.py", car], ["배경.py", background]]) {
            await writeFile(path.join(this.workspace, file), source, "utf8");
        }
    }

    async run(action = "/api/run") {
        const previous = this.state?.runId;
        const response = await this.request(action);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        await this.wait(() => this.state?.runId && this.state.runId !== previous, "new run");
    }

    async done(timeout = 10000) {
        await this.wait(() => ["completed", "error"].includes(this.state?.status), "run completion", timeout);
        this.state = (await this.request("/api/state")).body;
        return this.state;
    }

    async input(kind, fields = {}) {
        const response = await this.request("/api/input", { runId: this.state.runId, kind, x: 0, y: 0, ...fields });
        assert.equal(response.status, 200, JSON.stringify(response.body));
    }

    text() { return (this.state?.output || []).map(line => line.text).join("\n"); }
    sprite(name = "고양이") { return this.state?.scene?.sprites?.find(sprite => sprite.label === name); }

    async wait(predicate, description, timeout = 10000) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            if (await predicate()) return;
            await pause(20);
        }
        throw new Error(`${description}: ${JSON.stringify(this.state)}; ${this.output}`);
    }

    async stop() { if (this.address) await this.request("/api/stop"); }

    async close() {
        try { await this.stop(); } catch { /* A failed host may already be closed. */ }
        this.socket?.close();
        if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
            const ended = once(this.child, "exit");
            this.child.kill();
            await ended;
        }
        const report = path.join(toolRoot, "artifacts", "test-results");
        await mkdir(report, { recursive: true });
        await writeFile(path.join(report, "latest-integration-workspace.txt"), this.workspace || "");
    }
}
