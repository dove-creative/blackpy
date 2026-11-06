"""웹 무대의 고양이를 조종하는 수업용 명령입니다."""

import http.client
import json
import math
import os
from urllib.parse import urlsplit


class Character:
    """이동이 끝난 뒤 다음 명령을 실행하는 캐릭터입니다."""

    def forward(self, distance: float) -> None:
        """바라보는 방향으로 distance만큼 움직입니다."""
        self._send("forward", distance)

    def backward(self, distance: float) -> None:
        """바라보는 방향의 반대로 distance만큼 움직입니다."""
        self._send("backward", distance)

    def left(self, degrees: float) -> None:
        """왼쪽으로 degrees도 회전합니다."""
        self._send("left", degrees)

    def right(self, degrees: float) -> None:
        """오른쪽으로 degrees도 회전합니다."""
        self._send("right", degrees)

    def goto(self, x: float, y: float) -> None:
        """바라보는 방향을 유지하며 (x, y)로 움직입니다."""
        self._send("goto", x, y)

    def _send(self, command: str, *values: float) -> None:
        for value in values:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise TypeError("이동 거리와 각도에는 숫자를 넣어 주세요.")
            try:
                finite = math.isfinite(value)
            except OverflowError:
                finite = False
            if not finite:
                raise ValueError("이동 거리와 각도에는 유한한 숫자가 필요해요.")

        address = os.environ.get("PLAYGROUND_URL", "")
        token = os.environ.get("PLAYGROUND_TOKEN", "")
        run_id = os.environ.get("PLAYGROUND_RUN_ID", "")
        if not address or not token or not run_id:
            raise RuntimeError(
                "main.py를 저장한 뒤 웹 화면의 '시작' 버튼을 눌러 주세요."
            )

        endpoint = urlsplit(address)
        if endpoint.scheme != "http" or endpoint.hostname != "127.0.0.1":
            raise RuntimeError("실행 프로그램의 연결 주소를 확인해 주세요.")

        body = json.dumps(
            {
                "runId": run_id,
                "command": command,
                "args": values,
            },
            allow_nan=False,
        ).encode("utf-8")
        connection = http.client.HTTPConnection(
            endpoint.hostname, endpoint.port
        )
        try:
            connection.request(
                "POST",
                "/api/command",
                body=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Playground-Token": token,
                },
            )
            response = connection.getresponse()
            payload = response.read().decode("utf-8")
            if response.status != 200:
                try:
                    message = json.loads(payload).get("error", "실행이 끝났어요.")
                except (ValueError, AttributeError):
                    message = "실행 프로그램이 명령을 처리하지 못했어요."
                raise RuntimeError(message)
        except (OSError, http.client.HTTPException) as error:
            raise RuntimeError(
                "웹 무대와 연결이 끊겼어요. 시작.bat를 다시 실행해 주세요."
            ) from error
        finally:
            connection.close()


cat = Character()
