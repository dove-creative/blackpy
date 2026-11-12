"""캐릭터 파일에 자동으로 연결되는 상태와 명령입니다."""

import contextvars
import math
import random


EXECUTION = contextvars.ContextVar("blackpy_execution", default=(False, 0.0))
BACKGROUNDS = {"plain", "city", "dance", "track", "court", "forest"}
STYLES = {
    "car": (120, 70, "#ef7857"), "cat": (86, 96, "#ffbb55"),
    "rabbit": (82, 100, "#f0e9ff"), "ball": (64, 64, "#f78d38"),
    "bat": (120, 70, "#9a85d9"), "ghost": (72, 84, "#ddd9ff"),
    "star": (64, 64, "#ffd65a"), "basket": (110, 60, "#c88d50"),
    "paddle": (140, 24, "#479cb3"), "rocket": (90, 64, "#e5846c"),
    "flag": (50, 80, "#76bc73"), "planet": (90, 90, "#6aa7d5"),
}
STATE_NAMES = {
    "이름": "name", "위치": "position", "방향": "heading",
    "속도": "speed", "크기": "scale", "가시성": "visible",
    "배경": "background",
}


def number(value, label, minimum=-100000, maximum=100000):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{label}에는 숫자를 넣어 주세요.")
    if not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f"{label}에는 {minimum}~{maximum}의 숫자를 넣어 주세요.")
    return float(value)


def random_integer(minimum, maximum):
    if (isinstance(minimum, bool) or isinstance(maximum, bool)
            or not isinstance(minimum, int) or not isinstance(maximum, int)):
        raise TypeError("랜덤의 시작과 끝에는 정수를 넣어 주세요.")
    if minimum > maximum:
        raise ValueError("랜덤의 시작은 끝보다 클 수 없어요.")
    return random.randint(minimum, maximum)


def vector_angle(x, y):
    x = number(x, "가로 값", -float("inf"), float("inf"))
    y = number(y, "세로 값", -float("inf"), float("inf"))
    return math.degrees(math.atan2(y, x)) % 360


class ScriptObject:
    """파일 하나의 상태와 실행 대상을 보유합니다."""

    def __init__(self, runtime, specification, index, is_background=False):
        self.runtime = runtime
        self.is_background = is_background
        self.id = "background" if is_background else f"actor-{index}"
        self._name = "배경" if is_background else specification["name"]
        self.filename = specification["file"]
        self.kind = specification.get("kind", "plain" if is_background else "cat")
        self.namespace = {}
        self.handlers = {}
        self.speech = ""
        self._position = (0.0, 0.0)
        self._heading = 0.0
        self._speed = 1.0
        self._scale = 1.0
        self._visible = True

        if is_background:
            self.background = self.kind
        else:
            if self.kind not in STYLES:
                raise ValueError("준비된 캐릭터 모양을 사용해 주세요.")
            self.position = (specification.get("x", 0), specification.get("y", 0))
            self.heading = specification.get("heading", 0)
            self.speed = specification.get("speed", 1)
            self.scale = specification.get("scale", 1)
            self.visible = specification.get("visible", True)

    def require_actor(self):
        if self.is_background:
            raise ValueError("배경에서는 캐릭터의 움직임이나 크기를 사용할 수 없어요.")

    @property
    def name(self):
        return self._name

    @name.setter
    def name(self, value):
        raise ValueError("이름은 프로젝트 설정에서 정하며 코드에서 바꿀 수 없어요.")

    @property
    def position(self):
        self.require_actor()
        return self._position

    @position.setter
    def position(self, value):
        self.require_actor()
        if not isinstance(value, (tuple, list)) or len(value) != 2:
            raise TypeError("위치에는 (가로, 세로)처럼 숫자 두 개를 넣어 주세요.")
        self._position = (number(value[0], "가로 위치"), number(value[1], "세로 위치"))

    @property
    def heading(self):
        self.require_actor()
        return self._heading

    @heading.setter
    def heading(self, value):
        self.require_actor()
        self._heading = number(value, "방향", -1000000, 1000000) % 360

    @property
    def speed(self):
        self.require_actor()
        return self._speed

    @speed.setter
    def speed(self, value):
        self.require_actor()
        value = number(value, "속도 배율", 0, float("inf"))
        if value == 0:
            raise ValueError("속도 배율에는 0보다 큰 숫자를 넣어 주세요.")
        self._speed = value

    @property
    def scale(self):
        self.require_actor()
        return self._scale

    @scale.setter
    def scale(self, value):
        self.require_actor()
        self._scale = number(value, "크기", 0.1, 5)

    @property
    def visible(self):
        self.require_actor()
        return self._visible

    @visible.setter
    def visible(self, value):
        self.require_actor()
        if not isinstance(value, bool):
            raise TypeError("가시성에는 True 또는 False를 넣어 주세요.")
        self._visible = value

    @property
    def background(self):
        if not self.is_background:
            raise ValueError("배경 설정은 배경 파일에서 사용해 주세요.")
        return self.runtime.background_kind

    @background.setter
    def background(self, value):
        if not self.is_background:
            raise ValueError("배경 설정은 배경 파일에서 사용해 주세요.")
        if not isinstance(value, str) or value not in BACKGROUNDS:
            raise ValueError("준비된 배경 이름을 사용해 주세요.")
        self.runtime.background_kind = value

    @property
    def dimensions(self):
        width, height, _ = STYLES[self.kind]
        return width * self._scale, height * self._scale

    def apply_delta(self, x=0.0, y=0.0, heading=0.0):
        self.position = (self._position[0] + x, self._position[1] + y)
        self.heading = self._heading + heading

    async def forward(self, value):
        self.require_actor()
        value = number(value, "이동 값")
        radians = math.radians(self._heading)
        x, y = math.cos(radians) * value, math.sin(radians) * value
        continuous, delta_time = EXECUTION.get()

        if continuous:
            self.apply_delta(x * self._speed * delta_time, y * self._speed * delta_time)
        else:
            await self.runtime.animate(self, x, y, 0, abs(value) / (200 * self._speed))

    async def left(self, value):
        self.require_actor()
        value = number(value, "회전 값", -1000000, 1000000)
        continuous, delta_time = EXECUTION.get()

        if continuous:
            self.apply_delta(heading=value * self._speed * delta_time)
        else:
            await self.runtime.animate(self, 0, 0, value, abs(value) / (180 * self._speed))

    async def right(self, value):
        await self.left(-number(value, "회전 값", -1000000, 1000000))

    def goto(self, x, y):
        self.position = (x, y)

    def look(self, *values):
        self.require_actor()
        if len(values) == 1:
            self.heading = values[0]
        elif len(values) == 2:
            x = number(values[0], "가로 위치") - self._position[0]
            y = number(values[1], "세로 위치") - self._position[1]
            self.heading = vector_angle(x, y)
        else:
            raise TypeError("바라보기에는 각도 하나 또는 가로·세로 위치를 넣어 주세요.")

    def change_speed(self, value):
        self.speed += number(value, "속도 변화량")

    def change_scale(self, value):
        self.scale += number(value, "크기 변화량")

    def set_scale(self, value):
        self.scale = value

    def set_visible(self, value):
        self.visible = value

    def say(self, message):
        if not isinstance(message, str):
            raise TypeError("말하기에는 문자열을 넣어 주세요.")
        if len(message) > 200:
            raise ValueError("말하기는 200자까지 사용할 수 있어요.")
        if self.is_background:
            self.runtime.message = message
        else:
            self.speech = message

    def commands(self):
        return {
            "앞으로": self.forward, "왼쪽으로돌기": self.left,
            "오른쪽으로돌기": self.right, "좌표로": self.goto,
            "바라보기": self.look, "속도_변경": self.change_speed,
            "크기_바꾸기": self.change_scale, "크기_정하기": self.set_scale,
            "가시성_설정": self.set_visible, "말하기": self.say,
            "기다리기": self.runtime.wait, "방송하기": self.runtime.broadcast,
            "랜덤": random_integer, "각도로": vector_angle,
            "위치_구하기": self.runtime.position_of,
            "방향_구하기": self.runtime.heading_of,
        }

    def snapshot(self):
        width, height = self.dimensions
        return {
            "id": self.id, "kind": self.kind,
            "x": self._position[0], "y": self._position[1],
            "width": width, "height": height, "heading": self._heading,
            "color": STYLES[self.kind][2], "visible": self._visible,
            "label": self.name, "speech": self.speech,
        }
