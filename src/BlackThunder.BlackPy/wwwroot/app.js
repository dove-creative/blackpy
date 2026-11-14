"use strict";

(() => {
    const logicalWidth = 800;
    const logicalHeight = 600;
    const maximumReconnectAttempts = 10;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    const canvas = document.getElementById("stage");
    const context = canvas.getContext("2d");
    const connectionStatus = document.getElementById("connection-status");
    const connectionLabel = document.getElementById("connection-label");
    const runStatus = document.getElementById("run-status");
    const notice = document.getElementById("notice");
    const startButton = document.getElementById("start-button");
    const stopButton = document.getElementById("stop-button");
    const restartButton = document.getElementById("restart-button");
    const positionReport = document.getElementById("position-report");
    const sceneMessage = document.getElementById("scene-message");
    const inputHint = document.getElementById("input-hint");
    const categories = document.getElementById("categories");
    const commandCards = document.getElementById("command-cards");
    const categoryDescription = document.getElementById("category-description");
    const copyStatus = document.getElementById("copy-status");
    const outputLines = document.getElementById("output-lines");
    const outputPlaceholder = document.getElementById("output-placeholder");
    const consoleArea = document.querySelector(".console-area");
    const statusLabels = {
        ready: "시작할 준비가 됐어요",
        running: "코드를 실행하고 있어요",
        completed: "실행을 마쳤어요",
        stopped: "실행을 멈췄어요",
        error: "코드를 확인해 주세요"
    };

    let state = { status: "ready", runId: null, error: null, scene: null };
    let socket = null;
    let connected = false;
    let receivedSnapshot = false;
    let requestPending = false;
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    let leavingPage = false;
    let drawRequested = false;
    let pixelRatio = 1;
    let connectionNotice = "";
    let actionNotice = "";
    let inputRunId = null;
    let capturedPointer = null;
    let project = null;
    let projectImages = new Map();
    let selectedCategory = "events";
    let lookupName = "고양이";
    let positionSummary = "";
    let projectRequest = 0;
    let outputCount = 0;
    let pointerPosition = { x: 0, y: 0 };
    const heldKeys = new Map();
    const inputQueue = new window.BlackPyInput.InputQueue(sendInput, message => {
        heldKeys.clear();
        clearPointerCapture();
        actionNotice = message;
        updateControls();
    });
    const textInput = new window.BlackPyTextInput.TextInput({
        form: document.getElementById("text-input-form"),
        label: document.getElementById("text-input-label"),
        answer: document.getElementById("text-input-answer"),
        submit: document.getElementById("text-input-submit"),
        status: document.getElementById("text-input-status")
    }, sendAnswer, () => {
        releaseInput();
        outputPlaceholder.hidden = true;
        consoleArea.scrollTop = consoleArea.scrollHeight;
    });

    function updateLookupName() {
        const name = state.scene?.sprites[0]?.label || project?.actors[0]?.name || "고양이";
        if (lookupName === name) return;
        lookupName = name;
        renderPalette();
    }

    async function loadProject() {
        if (!token) return;
        const request = ++projectRequest;

        try {
            const response = await fetch("/api/project", { headers: { "X-Playground-Token": token } });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || "프로젝트 설정을 읽지 못했어요.");
            if (request !== projectRequest) return;
            if (!body.background?.file || !Array.isArray(body.actors)) {
                throw new Error("프로젝트의 배경과 캐릭터 설정을 확인해 주세요.");
            }

            project = body;
            updateLookupName();
            updatePosition();
            requestDraw();
            void loadImages(body, request);
        } catch (error) {
            if (request !== projectRequest) return;
            actionNotice = error instanceof Error ? error.message : "프로젝트를 확인해 주세요.";
            updateControls();
        }
    }

    async function loadImages(definition, request) {
        const names = [...new Set([definition.background?.image, ...definition.actors.map(actor => actor.image)]
            .filter(name => typeof name === "string" && name.length > 0))];
        const loaded = new Map();

        await Promise.all(names.map(async name => {
            try {
                const response = await fetch(`/api/image?name=${encodeURIComponent(name)}`,
                    { headers: { "X-Playground-Token": token } });
                if (!response.ok) {
                    const body = await response.json().catch(() => ({}));
                    throw new Error(body.error || `이미지를 불러오지 못했어요: ${name}`);
                }
                const url = URL.createObjectURL(await response.blob());
                const image = new Image();
                image.src = url;
                loaded.set(name, { image, url });
                await image.decode();
            } catch (error) {
                actionNotice = error instanceof Error ? error.message : `이미지를 확인해 주세요: ${name}`;
                updateControls();
            }
        }));

        if (request !== projectRequest) {
            for (const entry of loaded.values()) URL.revokeObjectURL(entry.url);
            return;
        }

        for (const entry of projectImages.values()) URL.revokeObjectURL(entry.url);
        projectImages = loaded;
        requestDraw();
    }

    function stageImages() {
        const actors = new Map();
        (project?.actors || []).forEach((actor, index) => {
            const entry = projectImages.get(actor.image);
            if (entry) actors.set(`actor-${index + 1}`, entry.image);
        });
        return {
            backgroundKind: project?.background?.kind || "plain",
            background: projectImages.get(project?.background?.image)?.image || null,
            actors
        };
    }

    function renderPalette() {
        const visibleCategories = window.BlackPyPalette.categories
            .filter(item => window.BlackPyPalette.availableCards(item.id).length > 0);

        if (!visibleCategories.some(item => item.id === selectedCategory)) {
            selectedCategory = "events";
        }

        categories.replaceChildren(...visibleCategories.map(category => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "category-button";
            button.style.setProperty("--category-color", category.color);
            button.setAttribute("aria-pressed", String(category.id === selectedCategory));
            const dot = document.createElement("span");
            dot.className = "category-dot";
            dot.setAttribute("aria-hidden", "true");
            const label = document.createElement("span");
            label.textContent = category.label;
            button.append(dot, label);
            button.addEventListener("click", () => { selectedCategory = category.id; renderPalette(); });
            return button;
        }));

        const descriptions = {
            events: "‘중’ 함수는 매 프레임 실행돼요. 배경의 클릭 이벤트는 캐릭터가 없는 빈 곳을 클릭할 때 실행돼요.",
            motion: "일반 함수의 숫자는 거리·각도예요. ‘중’ 함수에서는 초당 이동량·회전량이고, 속도 배율도 곱해져요.",
            physics: "물리 모드와 무게를 정하고, 힘을 주거나 닿은 캐릭터를 확인해요. 충돌 때문에 회전하지는 않아요.",
            looks: "캐릭터의 모습과 말을 바꿔요. 배경의 말하기는 무대 안내를 표시해요.",
            math: "숫자를 계산하고 조건을 만들어요.",
            sensing: "이름과 캐릭터의 위치를 알아봐요. 조회할 캐릭터 이름을 괄호 안에 넣어요."
        };
        categoryDescription.textContent = descriptions[selectedCategory];
        const category = visibleCategories.find(item => item.id === selectedCategory);
        const cards = window.BlackPyPalette.availableCards(selectedCategory, lookupName);
        commandCards.replaceChildren(...cards.flatMap(card => {
            const article = document.createElement("article");
            article.className = "command-card";
            article.style.setProperty("--category-color", category.color);
            const title = document.createElement("h3");
            title.textContent = card.title;
            if (card.actor) {
                const badge = document.createElement("span");
                badge.className = "actor-badge";
                badge.textContent = "캐릭터 전용";
                title.appendChild(badge);
            }
            article.appendChild(title);

            for (const row of card.rows) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "code-row";
                button.setAttribute("aria-label", `${row.label} 코드 복사`);
                const kind = document.createElement("span");
                kind.className = "code-kind";
                kind.textContent = { value: "값", command: "명령", event: "이벤트" }[row.kind];
                kind.setAttribute("aria-hidden", "true");
                const code = document.createElement("code");
                code.textContent = row.label;
                button.append(kind, code);
                button.addEventListener("click", () => copySnippet(row.code));
                article.appendChild(button);
            }

            if (card.note) {
                const note = document.createElement("p");
                note.className = "card-note";
                note.textContent = card.note;
                article.appendChild(note);
            }

            if (card.sectionStart) {
                const divider = document.createElement("hr");
                divider.className = "command-divider";
                return [divider, article];
            }

            return [article];
        }));
    }

    async function copySnippet(code) {
        try {
            await window.BlackPyPalette.copyCode(code, navigator.clipboard);
            copyStatus.classList.toggle("error", false);
            copyStatus.textContent = "복사했어요! 코드를 쓸 Python 파일에 붙여넣어요.";
        } catch (error) {
            copyStatus.classList.toggle("error", true);
            copyStatus.textContent = error instanceof Error ? error.message : "복사하지 못했어요. 다시 눌러 주세요.";
        }
    }

    function updatePosition() {
        const sprites = state.scene?.sprites || (project ? window.BlackPyPalette.previewScene(project).sprites : []);
        positionReport.hidden = sprites.length === 0;
        const labels = sprites.map(sprite =>
            `${sprite.label} · x ${numberLabel(sprite.x)} · y ${numberLabel(sprite.y)} · 방향 ${numberLabel(sprite.heading)}°`);
        const summary = JSON.stringify(labels);
        if (positionSummary === summary) return;
        positionSummary = summary;
        positionReport.replaceChildren(...labels.map(label => {
            const row = document.createElement("span");
            row.textContent = label;
            return row;
        }));
    }

    function updateControls() {
        const available = connected && receivedSnapshot && !requestPending;
        startButton.disabled = !available || state.status === "running";
        stopButton.disabled = !available || state.status !== "running";
        restartButton.disabled = !available;
        connectionStatus.classList.toggle("connected", connected && receivedSnapshot);
        connectionStatus.classList.toggle("disconnected", !connected && reconnectAttempts > 0);
        let connectionText = connected && receivedSnapshot ? "연결됐어요" : "연결 중";

        if (reconnectAttempts >= maximumReconnectAttempts && !connected) {
            connectionText = "연결 끊김";
        }

        if (!token) {
            connectionText = "연결 필요";
        }

        if (connectionLabel.textContent !== connectionText) {
            connectionLabel.textContent = connectionText;
        }

        const statusText = requestPending ? "잠시 기다려 주세요" : statusLabels[state.status];
        const label = receivedSnapshot ? statusText : "준비 중이에요";

        if (runStatus.textContent !== label) {
            runStatus.textContent = label;
        }

        runStatus.dataset.status = state.status;
        const message = connectionNotice || actionNotice || state.error || "";

        if (notice.textContent !== message) {
            notice.textContent = message;
        }

        notice.hidden = message.length === 0;
        updateInput();
        const answerRunId = connected && receivedSnapshot && state.status === "running" ? state.runId : null;
        textInput.update(answerRunId, state.scene?.textInput, requestPending);
        outputPlaceholder.hidden = outputCount > 0 || textInput.current !== null;
    }

    function updateInput() {
        const runId = connected && receivedSnapshot && !requestPending && state.status === "running"
            ? state.runId : null;

        if (runId !== inputRunId) {
            heldKeys.clear();
            clearPointerCapture();
            pointerPosition = { x: 0, y: 0 };
            inputRunId = runId;
            inputQueue.setRun(runId);
        }

        canvas.dataset.inputActive = String(runId !== null);
        const focused = document.activeElement === canvas;
        inputHint.textContent = runId
            ? (focused ? "무대에 입력하고 있어요. 마우스나 키보드로 놀아요."
                : "무대를 누른 뒤 마우스나 키보드로 놀아요.")
            : "시작하면 바로 키보드로 놀 수 있어요. 코드를 바꾼 뒤 다시 시작해요.";
    }

    async function sendInput(packet, signal) {
        const response = await fetch("/api/input", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Playground-Token": token },
            body: JSON.stringify(packet),
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
            keepalive: true
        });

        // A completed or replaced run can reject an input already on the wire.
        if (response.status === 409) return;

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(response.status === 429
                ? "입력이 너무 많아요. 키를 놓고 잠시 기다려 주세요."
                : body.error || "무대 입력을 보내지 못했어요. 다시 시작해 주세요.");
        }
    }

    async function sendAnswer(packet, signal) {
        const response = await fetch("/api/input", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Playground-Token": token },
            body: JSON.stringify(packet),
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)])
        });

        // Another tab or a replaced run may have already completed this question.
        if (response.status === 409) return;

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || "답을 보내지 못했어요. 다시 눌러 주세요.");
        }
    }

    function pointerPoint(event) {
        const bounds = canvas.getBoundingClientRect();
        const style = getComputedStyle(canvas);
        const left = parseFloat(style.borderLeftWidth) || 0;
        const top = parseFloat(style.borderTopWidth) || 0;
        const right = parseFloat(style.borderRightWidth) || 0;
        const bottom = parseFloat(style.borderBottomWidth) || 0;
        return window.BlackPyInput.stagePoint(event.clientX, event.clientY, {
            left: bounds.left + left,
            top: bounds.top + top,
            width: bounds.width - left - right,
            height: bounds.height - top - bottom
        }, logicalWidth, logicalHeight);
    }

    function pressPointer(event) {
        canvas.focus({ preventScroll: true });
        if (!inputRunId || event.button !== 0 || capturedPointer !== null) return;
        const point = pointerPoint(event);
        if (!point) return;

        event.preventDefault();
        pointerPosition = point;
        if (inputQueue.enqueue({ kind: "pointerdown", button: "왼쪽", ...point })) {
            capturedPointer = event.pointerId;
            canvas.setPointerCapture(event.pointerId);
        }
    }

    function releasePointer(event) {
        if (capturedPointer === null || capturedPointer !== event.pointerId) return;
        event.preventDefault();
        pointerPosition = pointerPoint(event) || pointerPosition;
        inputQueue.enqueue({ kind: "pointerup", button: "왼쪽", ...pointerPosition });
        clearPointerCapture();
    }

    function clearPointerCapture() {
        const pointer = capturedPointer;
        capturedPointer = null;
        if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    }

    function pressKey(event) {
        if (!inputRunId || document.activeElement !== canvas || event.isComposing
            || event.ctrlKey || event.metaKey || event.altKey) return;
        const key = window.BlackPyInput.normalizeKey(event.key);
        if (!key) return;

        event.preventDefault();
        const physicalKey = event.code || event.key;
        if (event.repeat || heldKeys.has(physicalKey)) return;

        if (inputQueue.enqueue({ kind: "keydown", key, ...pointerPosition })) {
            heldKeys.set(physicalKey, key);
        }
    }

    function releaseKey(event) {
        const physicalKey = event.code || event.key;
        const key = heldKeys.get(physicalKey);
        if (!key) return;

        heldKeys.delete(physicalKey);
        event.preventDefault();
        inputQueue.enqueue({ kind: "keyup", key, ...pointerPosition });
    }

    function releaseInput() {
        heldKeys.clear();
        clearPointerCapture();
        inputQueue.enqueue({ kind: "reset", ...pointerPosition });
    }

    function numberLabel(value) {
        const rounded = Math.round(value * 10) / 10;
        return String(Object.is(rounded, -0) ? 0 : rounded);
    }

    function applyState(message) {
        if (!message || !Object.hasOwn(statusLabels, message.status)) {
            return;
        }

        const newRun = message.runId !== state.runId;
        state = {
            status: message.status,
            runId: message.runId,
            error: typeof message.error === "string" ? message.error : null,
            scene: message.scene?.active === true ? message.scene : null
        };

        receivedSnapshot = true;
        reconnectAttempts = 0;
        connectionNotice = "";

        if (newRun) {
            actionNotice = "";
        }

        if (Array.isArray(message.output)) {
            renderOutput(message.output, newRun);
        }

        updateLookupName();
        updatePosition();
        sceneMessage.hidden = state.scene === null || !state.scene.message;

        const sceneText = state.scene?.message || "";
        if (sceneMessage.textContent !== sceneText) {
            sceneMessage.textContent = sceneText;
        }

        canvas.setAttribute("aria-label", state.scene
            ? `움직이는 놀이 무대. ${sceneText}`
            : "캐릭터를 움직이는 무대. 가운데가 원점이며 오른쪽과 위쪽이 양수입니다.");
        if (newRun) void loadProject();
        updateControls();
        requestDraw();
    }

    function renderOutput(lines, newRun) {
        const followOutput = newRun
            || consoleArea.scrollHeight - consoleArea.clientHeight - consoleArea.scrollTop < 48;
        const fragment = document.createDocumentFragment();

        for (const line of lines.slice(-1000)) {
            const element = document.createElement("div");
            element.className = line.stream === "stderr" ? "output-line stderr" : "output-line";
            element.textContent = typeof line.text === "string" ? line.text : "";
            fragment.appendChild(element);
        }

        outputLines.replaceChildren(fragment);
        outputCount = lines.length;
        outputPlaceholder.hidden = outputCount > 0 || textInput.current !== null;

        if (followOutput) {
            consoleArea.scrollTop = consoleArea.scrollHeight;
        }
    }

    async function sendAction(action) {
        if (!connected || !receivedSnapshot || requestPending) {
            return;
        }

        requestPending = true;
        actionNotice = "";
        updateControls();

        try {
            const response = await fetch(`/api/${action}`, {
                method: "POST",
                headers: { "X-Playground-Token": token }
            });
            const body = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(body.error || "실행 요청을 보내지 못했어요. 다시 눌러 주세요.");
            }

            if (body.status) {
                applyState(body);
            }

            if (action !== "stop") await loadProject();
        } catch (error) {
            actionNotice = error instanceof Error ? error.message : "연결을 확인해 주세요.";
        } finally {
            requestPending = false;
            updateControls();
        }
    }

    function connect() {
        if (!token || leavingPage) {
            return;
        }

        clearTimeout(reconnectTimer);
        receivedSnapshot = false;
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const socketUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
        const currentSocket = new WebSocket(socketUrl);
        socket = currentSocket;

        currentSocket.addEventListener("open", () => {
            if (socket !== currentSocket) return;
            connected = true;
            updateControls();
        });

        currentSocket.addEventListener("message", event => {
            if (socket !== currentSocket) return;

            try {
                const message = JSON.parse(event.data);

                if (!receivedSnapshot && message.type !== "snapshot") {
                    return;
                }

                if (message.type === "snapshot" || message.type === "state") {
                    applyState(message);
                }
            } catch {
                actionNotice = "화면 정보를 읽지 못했어요. 새로고침해 주세요.";
                updateControls();
            }
        });

        currentSocket.addEventListener("close", () => {
            if (socket !== currentSocket || leavingPage) return;
            connected = false;
            receivedSnapshot = false;
            reconnectAttempts += 1;

            if (reconnectAttempts < maximumReconnectAttempts) {
                connectionNotice = "연결이 끊어졌어요. 다시 연결하고 있어요.";
                reconnectTimer = window.setTimeout(connect, 1000);
            } else {
                connectionNotice = "실행 프로그램을 확인한 뒤 이 화면을 새로고침해 주세요.";
            }

            updateControls();
        });

        currentSocket.addEventListener("error", () => {
            if (socket !== currentSocket) return;
            connected = false;
            updateControls();
        });
    }

    function resizeCanvas() {
        pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = logicalWidth * pixelRatio;
        canvas.height = logicalHeight * pixelRatio;
        requestDraw();
    }

    function requestDraw() {
        if (drawRequested) return;
        drawRequested = true;

        window.requestAnimationFrame(() => {
            drawRequested = false;
            drawStage();
        });
    }

    function drawStage() {
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, logicalWidth, logicalHeight);
        const scene = state.scene?.active ? state.scene : window.BlackPyPalette.previewScene(project);
        window.BlackPySceneRenderer.draw(context, scene, stageImages());
    }

    // Moving focus before the request lets the first key press reach the new run.
    startButton.addEventListener("click", () => {
        canvas.focus({ preventScroll: true });
        void sendAction("run");
    });
    stopButton.addEventListener("click", () => sendAction("stop"));
    restartButton.addEventListener("click", () => {
        canvas.focus({ preventScroll: true });
        void sendAction("restart");
    });
    canvas.addEventListener("pointerdown", pressPointer);
    canvas.addEventListener("pointerup", releasePointer);
    canvas.addEventListener("pointercancel", releaseInput);
    canvas.addEventListener("lostpointercapture", () => {
        if (capturedPointer !== null) releaseInput();
    });
    canvas.addEventListener("contextmenu", event => {
        if (inputRunId) event.preventDefault();
    });
    canvas.addEventListener("pointermove", event => {
        if (!inputRunId) return;
        const point = pointerPoint(event);
        if (!point) return;

        pointerPosition = point;
        inputQueue.enqueue({ kind: "pointermove", ...point });
    });
    canvas.addEventListener("keydown", pressKey);
    canvas.addEventListener("focus", updateInput);
    canvas.addEventListener("blur", () => {
        releaseInput();
        updateInput();
    });
    window.addEventListener("keyup", releaseKey);
    window.addEventListener("blur", releaseInput);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) releaseInput();
    });
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("pagehide", () => {
        releaseInput();
        textInput.update(null, null);
        leavingPage = true;
        clearTimeout(reconnectTimer);
        socket?.close();
    });

    if (!token) {
        connectionNotice = "실습 폴더의 '시작.exe'를 열어 이 화면을 시작해 주세요.";
    }

    resizeCanvas();
    renderPalette();
    updateControls();
    connect();
    void loadProject();
})();
