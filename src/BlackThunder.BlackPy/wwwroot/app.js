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
    const positionX = document.getElementById("position-x");
    const positionY = document.getElementById("position-y");
    const positionHeading = document.getElementById("position-heading");
    const positionReport = document.getElementById("position-report");
    const sceneMessage = document.getElementById("scene-message");
    const offstageNote = document.getElementById("offstage-note");
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

    let state = { status: "ready", runId: null, x: 0, y: 0, heading: 0, error: null, scene: null };
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
            x: Number.isFinite(message.x) ? message.x : state.x,
            y: Number.isFinite(message.y) ? message.y : state.y,
            heading: Number.isFinite(message.heading) ? message.heading : state.heading,
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

        positionX.textContent = numberLabel(state.x);
        positionY.textContent = numberLabel(state.y);
        positionHeading.textContent = `${numberLabel(state.heading)}°`;
        positionReport.hidden = state.scene !== null;
        sceneMessage.hidden = state.scene === null || !state.scene.message;

        const sceneText = state.scene?.message || "";
        if (sceneMessage.textContent !== sceneText) {
            sceneMessage.textContent = sceneText;
        }

        canvas.setAttribute("aria-label", state.scene
            ? `움직이는 놀이 무대. ${sceneText}`
            : "고양이를 움직이는 무대. 가운데가 원점이며 오른쪽은 x의 양의 방향, 위쪽은 y의 양의 방향입니다.");
        offstageNote.hidden = state.scene !== null
            || (Math.abs(state.x) <= logicalWidth / 2 && Math.abs(state.y) <= logicalHeight / 2);
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
        outputPlaceholder.hidden = lines.length > 0;

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

        if (state.scene) {
            window.BlackPySceneRenderer.draw(context, state.scene);
            return;
        }

        context.fillStyle = "#fcfefa";
        context.fillRect(0, 0, logicalWidth, logicalHeight);
        context.lineWidth = 1;
        context.strokeStyle = "#e5ede6";
        context.beginPath();

        for (let x = 0; x <= logicalWidth; x += 50) {
            context.moveTo(x, 0);
            context.lineTo(x, logicalHeight);
        }

        for (let y = 0; y <= logicalHeight; y += 50) {
            context.moveTo(0, y);
            context.lineTo(logicalWidth, y);
        }

        context.stroke();
        context.strokeStyle = "#b6cbbb";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(0, logicalHeight / 2);
        context.lineTo(logicalWidth, logicalHeight / 2);
        context.moveTo(logicalWidth / 2, 0);
        context.lineTo(logicalWidth / 2, logicalHeight);
        context.stroke();
        context.font = '22px Consolas, "Malgun Gothic", monospace';
        context.fillStyle = "#708c78";
        context.textAlign = "right";
        context.fillText("x", logicalWidth - 14, logicalHeight / 2 - 13);
        context.textAlign = "left";
        context.fillText("y", logicalWidth / 2 + 13, 27);
        context.fillText("0", logicalWidth / 2 + 10, logicalHeight / 2 + 26);

        context.save();
        context.translate(logicalWidth / 2 + state.x, logicalHeight / 2 - state.y);
        context.rotate(-state.heading * Math.PI / 180);
        drawCat();
        context.restore();
    }

    function drawCat() {
        context.lineCap = "round";
        context.lineJoin = "round";

        context.strokeStyle = "#d79135";
        context.lineWidth = 10;
        context.beginPath();
        context.moveTo(-23, 5);
        context.bezierCurveTo(-51, 7, -54, -30, -36, -24);
        context.stroke();

        context.fillStyle = "#efb24c";
        context.strokeStyle = "#805b30";
        context.lineWidth = 2.5;
        context.beginPath();
        context.ellipse(-3, 4, 29, 19, 0, 0, Math.PI * 2);
        context.fill();
        context.stroke();

        context.fillStyle = "#ffcc73";
        context.beginPath();
        context.moveTo(6, -11);
        context.lineTo(7, -35);
        context.lineTo(24, -24);
        context.lineTo(37, -34);
        context.lineTo(42, -15);
        context.bezierCurveTo(59, 7, 36, 22, 18, 15);
        context.bezierCurveTo(5, 13, -2, 0, 6, -11);
        context.closePath();
        context.fill();
        context.stroke();

        context.fillStyle = "#dc9178";
        context.beginPath();
        context.moveTo(12, -27);
        context.lineTo(13, -15);
        context.lineTo(21, -21);
        context.closePath();
        context.fill();

        context.strokeStyle = "#97612e";
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(-17, -7);
        context.lineTo(-14, 0);
        context.moveTo(-5, -12);
        context.lineTo(-2, -4);
        context.moveTo(-13, 16);
        context.lineTo(-13, 23);
        context.lineTo(-4, 23);
        context.moveTo(15, 15);
        context.lineTo(15, 23);
        context.lineTo(24, 23);
        context.stroke();

        context.fillStyle = "#2b4540";
        context.beginPath();
        context.ellipse(35, -8, 3.3, 4.8, 0, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#b25f48";
        context.beginPath();
        context.moveTo(47, -1);
        context.lineTo(54, 1);
        context.lineTo(48, 5);
        context.closePath();
        context.fill();

        context.strokeStyle = "#496c59";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(41, 6);
        context.lineTo(55, 9);
        context.moveTo(40, 10);
        context.lineTo(51, 15);
        context.stroke();

        context.fillStyle = "#408675";
        context.beginPath();
        context.moveTo(69, -7);
        context.lineTo(79, 0);
        context.lineTo(69, 7);
        context.closePath();
        context.fill();
    }

    startButton.addEventListener("click", () => sendAction("run"));
    stopButton.addEventListener("click", () => sendAction("stop"));
    restartButton.addEventListener("click", () => sendAction("restart"));
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("pagehide", () => {
        leavingPage = true;
        clearTimeout(reconnectTimer);
        socket?.close();
    });

    if (!token) {
        connectionNotice = "실습 폴더의 '시작.bat'을 열어 이 화면을 시작해 주세요.";
    }

    resizeCanvas();
    updateControls();
    connect();
})();
