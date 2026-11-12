"use strict";

(() => {
    class TextInput {
        constructor(elements, send, onOpen = () => {}) {
            this.elements = elements;
            this.send = send;
            this.onOpen = onOpen;
            this.current = null;
            this.request = null;
            this.submitted = false;
            this.disabled = false;
            this.composing = false;
            this.needsFocus = false;
            elements.form.hidden = true;
            elements.form.addEventListener("submit", event => {
                event.preventDefault();
                if (!this.composing) void this.submit();
            });
            elements.answer.addEventListener("compositionstart", () => { this.composing = true; });
            elements.answer.addEventListener("compositionend", () => { this.composing = false; });
            elements.answer.addEventListener("keydown", event => {
                if (event.key === "Enter" && (this.composing || event.isComposing || event.keyCode === 229)) {
                    event.preventDefault();
                }
            });
        }

        update(runId, prompt, disabled = false) {
            const next = runId && Number.isSafeInteger(prompt?.id) && prompt.id > 0
                ? { runId, promptId: prompt.id } : null;
            this.disabled = disabled;

            if (next?.runId === this.current?.runId && next?.promptId === this.current?.promptId) {
                this.renderControls();
                this.focusPrompt();
                return;
            }

            this.request?.abort();
            this.request = null;
            this.current = next;
            this.submitted = false;
            this.composing = false;
            this.needsFocus = next !== null;
            const { form, label, answer, status } = this.elements;
            answer.value = "";
            status.textContent = "";
            label.textContent = next ? prompt.message : "";
            answer.setAttribute("aria-label", label.textContent || "입력");
            form.hidden = next === null;
            this.renderControls();

            if (next) {
                this.onOpen();
                this.focusPrompt();
            }
        }

        focusPrompt() {
            if (!this.needsFocus || this.disabled || this.request || this.submitted) return;
            this.needsFocus = false;
            this.elements.answer.focus();
        }

        renderControls() {
            const unavailable = this.current === null || this.disabled || this.request !== null || this.submitted;
            this.elements.answer.disabled = unavailable;
            this.elements.submit.disabled = unavailable;
            this.elements.submit.textContent = this.request ? "…" : "↵";
            this.elements.form.setAttribute("aria-busy", String(this.request !== null));
        }

        async submit() {
            if (!this.current || this.disabled || this.request || this.submitted || this.composing) return;
            const { answer, status } = this.elements;
            const text = answer.value;

            if (text.length > 4096 || /[\r\n]/.test(text)) {
                status.textContent = "답은 줄바꿈 없이 4,096자까지 입력해 주세요.";
                return;
            }

            const current = this.current;
            const request = new AbortController();
            this.request = request;
            status.textContent = "";
            this.renderControls();

            try {
                await this.send({ ...current, kind: "answer", text }, request.signal);
                if (this.current !== current) return;
                this.submitted = true;
            } catch (error) {
                if (this.current !== current || request.signal.aborted) return;
                status.textContent = error instanceof Error
                    ? error.message : "답을 보내지 못했어요. 다시 눌러 주세요.";
            } finally {
                if (this.current === current) {
                    this.request = null;
                    this.renderControls();
                }
            }
        }
    }

    const api = Object.freeze({ TextInput });
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else window.BlackPyTextInput = api;
})();
