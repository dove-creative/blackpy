"use strict";

(() => {
    const keyNames = {
        ArrowLeft: "왼쪽", ArrowRight: "오른쪽", ArrowUp: "위", ArrowDown: "아래",
        " ": "스페이스", Enter: "엔터", Escape: "탈출"
    };

    function normalizeKey(key) {
        if (Object.hasOwn(keyNames, key)) return keyNames[key];
        return typeof key === "string" && /^[!-~]$/.test(key) ? key.toLowerCase() : null;
    }

    function stagePoint(clientX, clientY, rectangle, width = 800, height = 600) {
        const scale = Math.min(rectangle.width / width, rectangle.height / height);
        if (!(scale > 0)) return null;

        const left = rectangle.left + (rectangle.width - width * scale) / 2;
        const top = rectangle.top + (rectangle.height - height * scale) / 2;
        const x = (clientX - left) / scale - width / 2;
        const y = height / 2 - (clientY - top) / scale;
        if (Math.abs(x) > width / 2 || Math.abs(y) > height / 2) return null;

        return { x: Object.is(x, -0) ? 0 : x, y: Object.is(y, -0) ? 0 : y };
    }

    // One request at a time preserves key-down/up ordering within each run.
    class InputQueue {
        constructor(send, onError, maximum = 64) {
            this.send = send;
            this.onError = onError;
            this.maximum = maximum;
            this.runId = null;
            this.pending = [];
            this.generation = 0;
            this.busy = false;
            this.controller = null;
        }

        setRun(runId) {
            if (this.runId === runId) return;
            this.runId = runId;
            this.pending = [];
            this.generation += 1;
            this.controller?.abort();
            this.controller = null;
            this.busy = false;
        }

        enqueue(event) {
            if (!this.runId) return false;
            const packet = { ...event, runId: this.runId };
            const last = this.pending.at(-1);

            if (event.kind === "reset") {
                this.pending = [packet];
            } else if (event.kind === "pointermove" && last?.kind === "pointermove") {
                this.pending[this.pending.length - 1] = packet;
            } else if (this.pending.length >= this.maximum) {
                if (event.kind === "pointermove") return false;
                this.pending = [{ runId: this.runId, kind: "reset", x: 0, y: 0 }];
                this.onError("입력이 너무 많아요. 키를 놓고 잠시 기다려 주세요.");
                void this.drain();
                return false;
            } else {
                this.pending.push(packet);
            }

            void this.drain();
            return true;
        }

        async drain() {
            if (this.busy || !this.runId) return;
            const generation = this.generation;
            this.busy = true;

            try {
                while (this.pending.length && generation === this.generation) {
                    const packet = this.pending.shift();
                    const controller = new AbortController();
                    this.controller = controller;

                    try {
                        await this.send(packet, controller.signal);
                    } catch (error) {
                        if (generation !== this.generation) return;
                        this.pending = packet.kind === "reset" ? []
                            : [{ runId: this.runId, kind: "reset", x: 0, y: 0 }];
                        this.onError(error instanceof Error ? error.message : "무대 연결을 확인해 주세요.");
                    }
                }
            } finally {
                if (generation === this.generation) {
                    this.busy = false;
                    this.controller = null;
                }
            }
        }
    }

    const api = { normalizeKey, stagePoint, InputQueue };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else window.BlackPyInput = api;
})();
