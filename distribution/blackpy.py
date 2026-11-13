"""캐릭터 파일에 자동으로 연결되는 상태와 명령입니다."""

import contextvars
import math
import random


EXECUTION = contextvars.ContextVar("blackpy_execution", default=(False, 0.0))
MOVEMENT = contextvars.ContextVar("blackpy_movement", default=None)
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
    "배경": "background", "물리": "physics", "무게": "mass",
    "닿은_객체_리스트": "touching_names",
}
PHYSICS_MODES = {"없음", "충돌만", "물리"}


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
        self._speech_revision = 0
        self._position = (0.0, 0.0)
        self._heading = 0.0
        self._speed = 1.0
        self._scale = 1.0
        self._visible = True
        self._flip_horizontal = False
        self._flip_vertical = False
        self._physics = "충돌만"
        self._trigger = False
        self._mass = 1.0
        self._physics_commands = []
        self._absolute_revision = 0
        self._heading_revision = 0

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
            self.mass = specification.get("mass", 1)
            self.set_physics(specification.get("physics", "충돌만"),
                             specification.get("trigger", False))
            self._physics_baseline = self.physics_snapshot()

    def require_actor(self):
        if self.is_background:
            raise ValueError("배경에는 캐릭터 전용 상태 값이 없어요.")

    @property
    def name(self):
        return self._name

    @name.setter
    def name(self, value):
        raise ValueError("이름을 바꿀 때에는 이름_정하기(\"새이름\")를 사용해 주세요.")

    def set_name(self, value):
        if self.is_background:
            return

        self.runtime.rename(self, value)

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
        self._absolute_revision += 1
        self.queue_physics("teleport", *self._position)

    @property
    def heading(self):
        self.require_actor()
        return self._heading

    @heading.setter
    def heading(self, value):
        self.require_actor()
        movement = MOVEMENT.get()
        if movement is not None and movement["actor"] is self:
            movement["heading_fixed"] = True
        self._heading = number(value, "방향", -1000000, 1000000) % 360
        self._heading_revision += 1
        if self.runtime.remote_exchange is not None:
            self.queue_physics("heading", self._heading)

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
        value = number(value, "크기", 0.1, 5)
        self.validate_physics_size(self._physics, value)
        self._scale = value
        self.queue_physics("resize", *self.dimensions)

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
        self.queue_physics("visible", int(value))

    @property
    def physics(self):
        self.require_actor()
        return self._physics

    @physics.setter
    def physics(self, value):
        self.require_actor()
        if not isinstance(value, str) or value not in PHYSICS_MODES:
            raise ValueError('물리에는 "없음", "충돌만", "물리" 중 하나를 넣어 주세요.')
        self.validate_physics_size(value, self._scale)
        self._physics = value
        self.queue_physics("mode", mode=value, trigger=self._trigger)

    @property
    def mass(self):
        self.require_actor()
        return self._mass

    @mass.setter
    def mass(self, value):
        self.require_actor()
        self._mass = number(value, "무게", 0.001, 100000)
        self.queue_physics("mass", self._mass)

    @property
    def touching_names(self):
        self.require_actor()
        contacts = self.runtime.contacts[self.id]
        return [actor.name for actor in self.runtime.actors if actor.id in contacts]

    def validate_physics_size(self, mode, scale):
        width, height, _ = STYLES[self.kind]
        if mode == "물리" and (width * scale > 800 or height * scale > 600):
            raise ValueError("물리 객체의 크기는 무대의 가로 800, 세로 600 안에 들어가야 해요.")

    def queue_physics(self, kind, x=0.0, y=0.0, mode="", **fields):
        if len(self._physics_commands) >= 4096:
            raise RuntimeError("한 프레임에 물리 명령이 너무 많아요. 반복문에 기다리기를 넣어 주세요.")
        self._physics_commands.append({"id": self.id, "kind": kind, "x": x, "y": y, "mode": mode, **fields})

    def set_physics(self, value, 트리거=False):
        if self.is_background:
            return

        if not isinstance(트리거, bool):
            raise TypeError("트리거에는 True 또는 False를 넣어 주세요.")
        if not isinstance(value, str) or value not in PHYSICS_MODES:
            raise ValueError('물리에는 "없음", "충돌만", "물리" 중 하나를 넣어 주세요.')
        self.validate_physics_size(value, self._scale)
        self._trigger = 트리거
        self.physics = value

    def set_mass(self, value):
        if self.is_background:
            return

        self.mass = value

    def impulse(self, angle, strength):
        if self.is_background:
            return

        if self._physics != "물리":
            raise ValueError('힘을 주기 전에 물리_설정("물리")로 설정해 주세요.')
        angle = number(angle, "힘의 방향", -1000000, 1000000)
        strength = number(strength, "힘의 크기", 0, 100000)
        radians = math.radians(angle)
        self.queue_physics("impulse", math.cos(radians) * strength, math.sin(radians) * strength)

    def stop(self):
        if self.is_background:
            return

        self.queue_physics("stop")

    def physics_snapshot(self):
        width, height = self.dimensions
        return {
            "id": self.id, "x": self._position[0], "y": self._position[1],
            "width": width, "height": height, "mode": self._physics,
            "mass": self._mass, "visible": self._visible,
            "heading": self._heading, "trigger": self._trigger,
        }

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
        self.require_actor()
        if x or y:
            self._position = (
                number(self._position[0] + x, "가로 위치"),
                number(self._position[1] + y, "세로 위치"),
            )
            self.queue_physics("move", x, y)
        self.heading = self._heading + heading

    async def forward(self, value):
        if self.is_background:
            return

        value = number(value, "이동 값")
        radians = math.radians(self._heading)
        x, y = math.cos(radians) * value, math.sin(radians) * value
        continuous, delta_time = EXECUTION.get()

        if continuous:
            if not self.runtime.movement_active(MOVEMENT.get()):
                return
            if self.runtime.remote_exchange is not None:
                movement = MOVEMENT.get()
                if movement is not None and movement.get("heading_fixed"):
                    self.runtime.change_rate(self, x * self._speed, y * self._speed)
                else:
                    self.runtime.change_rate(self, forward=value * self._speed)
            else:
                self.apply_delta(x * self._speed * delta_time, y * self._speed * delta_time)
        else:
            await self.runtime.animate(self, x, y, 0, abs(value) / (200 * self._speed))

    async def left(self, value):
        if self.is_background:
            return

        value = number(value, "회전 값", -1000000, 1000000)
        continuous, delta_time = EXECUTION.get()

        if continuous:
            if not self.runtime.movement_active(MOVEMENT.get()):
                return
            if self.runtime.remote_exchange is not None:
                self.runtime.change_rate(self, rotation=value * self._speed)
            else:
                self.apply_delta(heading=value * self._speed * delta_time)
        else:
            await self.runtime.animate(self, 0, 0, value, abs(value) / (180 * self._speed))

    async def right(self, value):
        if self.is_background:
            return

        await self.left(-number(value, "회전 값", -1000000, 1000000))

    def flip(self, axis):
        if self.is_background:
            return

        if not isinstance(axis, str):
            raise TypeError('뒤집기에는 "가로" 또는 "세로"를 넣어 주세요.')
        if axis == "가로":
            self._flip_horizontal = not self._flip_horizontal
        elif axis == "세로":
            self._flip_vertical = not self._flip_vertical
        else:
            raise ValueError('뒤집기에는 "가로" 또는 "세로"를 넣어 주세요.')

    def goto(self, x, y):
        if self.is_background:
            return

        self.position = (x, y)

    def look(self, *values):
        if self.is_background:
            return

        if len(values) == 1:
            self.heading = values[0]
        elif len(values) == 2:
            x = number(values[0], "가로 위치") - self._position[0]
            y = number(values[1], "세로 위치") - self._position[1]
            self.heading = vector_angle(x, y)
        else:
            raise TypeError("바라보기에는 각도 하나 또는 가로·세로 위치를 넣어 주세요.")

    def change_speed(self, value):
        if self.is_background:
            return

        self.speed += number(value, "속도 변화량")

    def change_scale(self, value):
        if self.is_background:
            return

        self.scale += number(value, "크기 변화량")

    def set_scale(self, value):
        if self.is_background:
            return

        self.scale = value

    def set_visible(self, value):
        if self.is_background:
            return

        self.visible = value

    def say(self, *messages, 시간=None):
        message = " ".join(str(part) for part in messages)
        if len(message) > 200:
            raise ValueError("말하기는 200자까지 사용할 수 있어요.")
        if 시간 is not None:
            duration = number(시간, "말하기 시간", 0, 3600)
            if not self.runtime.initialized:
                raise RuntimeError(
                    "시간을 정한 말하기는 시작 또는 이벤트 함수 안에서 사용해 주세요."
                )
            return self.say_for(message, duration)
        self.set_speech(message)

    def set_speech(self, message):
        self._speech_revision += 1
        if self.is_background:
            self.runtime.message = message
        else:
            self.speech = message

    async def say_for(self, message, duration):
        self.set_speech(message)
        revision = self._speech_revision
        await self.runtime.wait(duration)
        if self._speech_revision == revision:
            self.set_speech("")

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
            "물리_설정": self.set_physics, "무게_설정": self.set_mass,
            "힘_작용": self.impulse, "정지": self.stop,
            "이름_정하기": self.set_name,
            "왼쪽_돌기": self.left, "오른쪽_돌기": self.right,
            "뒤집기": self.flip,
        }

    def snapshot(self):
        width, height = self.dimensions
        return {
            "id": self.id, "kind": self.kind,
            "x": self._position[0], "y": self._position[1],
            "width": width, "height": height, "heading": self._heading,
            "color": STYLES[self.kind][2], "visible": self._visible,
            "flipHorizontal": self._flip_horizontal, "flipVertical": self._flip_vertical,
            "label": self.name, "speech": self.speech,
        }
