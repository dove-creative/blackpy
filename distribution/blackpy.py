"""웹 무대에서 캐릭터와 함께 움직임 놀이를 만드는 명령입니다."""

import http.client
import json
import math
import os
import time
from urllib.parse import urlsplit


def _number(value, name, minimum=-100000, maximum=100000):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name}에는 숫자를 넣어 주세요.")

    if not minimum <= value <= maximum or not math.isfinite(value):
        raise ValueError(f"{name}에는 {minimum}~{maximum}의 숫자를 넣어 주세요.")

    return float(value)


class _Stage:
    def __init__(self):
        self._actors = []
        self._background = "plain"
        self._message = ""
        self._connection = None
        self._token = ""
        self._run_id = ""

    def background(self, name):
        """준비된 배경으로 바꿉니다. 캐릭터 위치는 그대로입니다."""
        if name not in ("plain", "city", "dance", "track", "court", "forest"):
            raise ValueError("배경 이름을 시작 코드와 비교해 주세요.")

        self._background = name
        self._publish()

    def say(self, message):
        """무대 위에 짧은 글을 보여 줍니다. 소리는 나지 않습니다."""
        if not isinstance(message, str) or len(message) > 200:
            raise ValueError("무대 글은 200자 안쪽의 문자열로 적어 주세요.")

        self._message = message
        self._publish()

    def wait(self, seconds):
        """지정한 시간 동안 장면을 보여 준 뒤 다음 명령으로 갑니다."""
        self._animate(_number(seconds, "기다리는 시간", 0, 3600), lambda _: None)

    def race(self, *actors, finish_x=260):
        """각자의 속도로 함께 달립니다. 모두 도착하면 1등 이름을 줍니다."""
        finish_x = _number(finish_x, "도착 위치")
        self._check_actors(actors)
        starts = [actor.x for actor in actors]

        if any(start > finish_x for start in starts):
            raise ValueError("출발 위치는 도착선의 왼쪽에 두어 주세요.")

        arrivals = [
            (finish_x - actor.x) / actor._speed for actor in actors
        ]
        duration = max(arrivals)

        def update(progress):
            elapsed = duration * progress

            for actor, start in zip(actors, starts):
                actor._x = min(finish_x, start + actor._speed * elapsed)

        self._animate(duration, update)
        first = min(arrivals)
        winners = [
            actor.name for actor, arrival in zip(actors, arrivals)
            if math.isclose(arrival, first, abs_tol=0.000001)
        ]
        return (
            winners[0] if len(winners) == 1 else "공동 1등: " + ", ".join(winners)
        )

    def dribble(self, player, ball, bounces=4, height=100, distance=360):
        """친구와 공이 함께 이동하고 공은 위아래로 튑니다."""
        self._check_actors((player, ball))

        if isinstance(bounces, bool) or not isinstance(bounces, int):
            raise TypeError("튀는 횟수에는 정수를 넣어 주세요.")
        if not 1 <= bounces <= 50:
            raise ValueError("튀는 횟수는 1~50번으로 정해 주세요.")

        height = _number(height, "튀는 높이", 0, 200)
        distance = _number(distance, "이동 거리")
        player_x, ball_x, ground_y = player.x, ball.x, ball.y
        _number(player_x + distance, "친구의 도착 위치")
        _number(ball_x + distance, "공의 도착 위치")
        _number(ground_y + height, "공의 가장 높은 위치")

        def update(progress):
            player._x = player_x + distance * progress
            ball._x = ball_x + distance * progress
            ball._y = ground_y + height * abs(
                math.sin(math.pi * bounces * progress)
            )

        self._animate(bounces * 0.7, update)
        ball._y = ground_y
        self._publish()

    def _check_actors(self, actors):
        if not actors or len({id(actor) for actor in actors}) != len(actors):
            raise ValueError("서로 다른 캐릭터를 하나 이상 넣어 주세요.")

        if any(actor not in self._actors for actor in actors):
            raise ValueError("Actor로 만든 캐릭터를 넣어 주세요.")

    def _animate(self, duration, update):
        started = time.monotonic()
        update(0)
        self._publish()

        while True:
            elapsed = time.monotonic() - started
            progress = 1 if duration - elapsed <= 1e-9 else elapsed / duration
            update(progress)
            self._publish()

            if progress == 1:
                return

            time.sleep(min(1 / 30, max(0, duration - elapsed)))

    def _publish(self):
        self._send({
            "background": self._background,
            "sprites": [actor._snapshot() for actor in self._actors],
            "message": self._message,
        })

    def _send(self, scene):
        if self._connection is None:
            address = os.environ.get("PLAYGROUND_URL", "")
            self._token = os.environ.get("PLAYGROUND_TOKEN", "")
            self._run_id = os.environ.get("PLAYGROUND_RUN_ID", "")
            endpoint = urlsplit(address)

            if not address or not self._token or not self._run_id:
                raise RuntimeError(
                    "main.py를 저장한 뒤 웹 화면의 '시작' 버튼을 눌러 주세요."
                )

            if endpoint.scheme != "http" or endpoint.hostname != "127.0.0.1":
                raise RuntimeError("실행 프로그램의 연결 주소를 확인해 주세요.")

            self._connection = http.client.HTTPConnection(
                endpoint.hostname, endpoint.port, timeout=15
            )

        body = json.dumps(
            {"runId": self._run_id, "scene": scene}, allow_nan=False
        ).encode("utf-8")

        try:
            self._connection.request(
                "POST", "/api/frame", body=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Playground-Token": self._token,
                },
            )
            response = self._connection.getresponse()
            payload = response.read().decode("utf-8")

            if response.status != 200:
                try:
                    message = json.loads(payload).get("error", "실행이 끝났어요.")
                except (ValueError, AttributeError):
                    message = "실행 프로그램이 장면을 처리하지 못했어요."

                raise RuntimeError(message)
        except (OSError, http.client.HTTPException) as error:
            self._connection.close()
            self._connection = None
            raise RuntimeError(
                "웹 무대와 연결이 끊겼어요. 시작.bat를 다시 실행해 주세요."
            ) from error


class Actor:
    """외형을 고르고 이동·회전하는 놀이 캐릭터입니다."""

    _styles = {
        "car": (120, 70, "#ef7857"),
        "cat": (86, 96, "#ffbb55"),
        "rabbit": (82, 100, "#f0e9ff"),
        "ball": (64, 64, "#f78d38"),
        "bat": (120, 70, "#9a85d9"),
    }

    def __init__(self, kind, x=0, y=0, name="", scale=1):
        if kind not in self._styles:
            raise ValueError("캐릭터 이름을 시작 코드와 비교해 주세요.")
        if not isinstance(name, str) or len(name) > 80:
            raise ValueError("이름은 80자 안쪽의 문자열로 적어 주세요.")
        if len(stage._actors) >= 16:
            raise ValueError("한 무대에는 캐릭터를 16개까지 만들 수 있어요.")

        scale = _number(scale, "크기", 0.1, 5)
        width, height, color = self._styles[kind]
        self._kind = kind
        self._x = _number(x, "가로 위치")
        self._y = _number(y, "세로 위치")
        self._name = name or kind
        self._width = width * scale
        self._height = height * scale
        self._color = color
        self._heading = 0.0
        self._speed = 200.0
        self._id = "actor-" + str(len(stage._actors) + 1)
        stage._actors.append(self)
        stage._publish()

    @property
    def x(self):
        return self._x

    @property
    def y(self):
        return self._y

    @property
    def name(self):
        return self._name

    def set_speed(self, speed):
        """앞으로·뒤로·좌표 이동과 달리기의 초당 이동량을 정합니다."""
        self._speed = _number(speed, "이동 속도", 1, 2000)

    def forward(self, distance):
        """바라보는 쪽으로 움직인 뒤 다음 명령으로 갑니다."""
        distance = _number(distance, "이동 거리")
        radians = math.radians(self._heading)
        self.goto(
            self.x + distance * math.cos(radians),
            self.y + distance * math.sin(radians),
        )

    def backward(self, distance):
        self.forward(-_number(distance, "이동 거리"))

    def goto(self, x, y):
        """방향을 유지하면서 지정한 위치로 움직입니다."""
        x = _number(x, "가로 위치")
        y = _number(y, "세로 위치")
        start_x, start_y = self.x, self.y
        duration = math.hypot(x - start_x, y - start_y) / self._speed

        def update(progress):
            self._x = start_x + (x - start_x) * progress
            self._y = start_y + (y - start_y) * progress

        stage._animate(duration, update)

    def left(self, degrees):
        """왼쪽으로 회전합니다. 한 바퀴는 360도입니다."""
        degrees = _number(degrees, "회전 각도")
        start_heading = self._heading

        def update(progress):
            self._heading = start_heading + degrees * progress

        stage._animate(abs(degrees) / 180, update)
        self._heading %= 360
        stage._publish()

    def right(self, degrees):
        self.left(-_number(degrees, "회전 각도"))

    def _snapshot(self):
        return {
            "id": self._id, "kind": self._kind,
            "x": self.x, "y": self.y,
            "width": self._width, "height": self._height,
            "heading": self._heading, "color": self._color,
            "visible": True, "label": self.name,
        }


stage = _Stage()
