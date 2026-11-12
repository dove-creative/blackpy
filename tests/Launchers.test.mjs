import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { TestHost, distributionRoot, toolRoot } from "./TestHost.mjs";

for (const name of ["01-movement", "02-keyboard", "03-click", "04-broadcast", "05-contact"]) {
    test(`${name} GUI launcher selects its own project and exits after the browser closes`, async () => {
        const temporaryRoot = await mkdtemp(path.join(tmpdir(), "BlackPy GUI 샘플 "));
        const workspace = path.join(temporaryRoot, "samples", name);
        await cp(path.join(toolRoot, "samples", name), workspace, { recursive: true });
        await mkdir(path.join(temporaryRoot, "artifacts"));
        await symlink(distributionRoot, path.join(temporaryRoot, "artifacts", "blackpy"), "junction");
        const executable = path.join(workspace, "시작.exe");
        const binary = await readFile(executable);
        const peOffset = binary.readUInt32LE(0x3c);
        assert.equal(binary.readUInt16LE(peOffset + 24 + 68), 2, "GUI subsystem must not allocate a console");
        const expected = JSON.parse(await readFile(path.join(workspace, "project.json"), "utf8"));
        const host = new TestHost();

        try {
            await host.open({ workspace, executable, args: ["--no-browser"] });
            const metadata = await host.request("/api/project");
            assert.equal(metadata.status, 200);
            assert.deepEqual(metadata.body.actors, expected.actors.map(actor => ({
                scale: 1, speed: 1, visible: true, ...actor
            })));
            assert.equal(metadata.body.background.kind, expected.background.kind);
            await host.run();
            await host.wait(() => host.state?.scene?.active, "GUI project execution");
            host.socket.close();
            await host.wait(() => host.child.exitCode !== null, "GUI host shutdown");
            assert.equal(host.child.exitCode, 0, host.output);
        } finally {
            await host.close();
        }
    });
}
