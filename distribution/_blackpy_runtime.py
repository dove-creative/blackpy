"""고정한 프로젝트의 프레임, 입력과 이벤트 호출을 관리합니다."""

import asyncio
import base64
import http.client
import inspect
import io
import json
import linecache
import os
from pathlib import Path
import time
import tokenize
from urllib.parse import urlencode, urlsplit

from blackpy import EXECUTION, ScriptObject, number
from _blackpy_compiler import compile_script


EVENT_ARGUMENTS = {
    "시작": 0,
    "키_클릭": 1, "키_클릭_중": 1, "키_클릭_끝": 1,
    "자신_클릭": 0, "자신_클릭_중": 0, "자신_클릭_끝": 0,
    "방송_받기": 1,
    "닿았을_때": 1, "닿는_중": 1, "닿는_중_종료": 1,
}
CONTINUOUS_EVENTS = {"키_클릭_중", "자신_클릭_중", "닿는_중"}
CONTACT_EVENTS = {"닿았을_때", "닿는_중", "닿는_중_종료"}


async def invoke(function, *args, **kwargs):
    result = function(*args, **kwargs)
    return await result if inspect.isawaitable(result) else result


class ProjectRuntime:
    """한 실행 안의 객체와 협력 실행 작업을 소유합니다."""

    def __init__(self, snapshot, maximum_calls=4096):
        self.project = snapshot["project"]
        self.sources = snapshot["sources"]
        self.maximum_calls = maximum_calls
        self.background_kind = "plain"
        self.message = ""
        self.objects = []
        specifications = [self.project["background"], *self.project.get("actors", [])]

        for index, specification in enumerate(specifications):
            script_type = type(f"Script_{index}", (ScriptObject,), {})
            self.objects.append(script_type(self, specification, index, index == 0))

        self.background = self.objects[0]
        self.actors = self.objects[1:]
        self.by_name = {obj.name: obj for obj in self.objects}
        if len(self.by_name) != len(self.objects):
            raise ValueError("캐릭터 이름은 서로 다르게 정해 주세요.")
        self.held_keys = set()
        self.pointer_target = None
        self.contacts = {actor.id: set() for actor in self.actors}
        self.tasks = set()
        self.guards = set()
        self.motions = []
        self.timers = []
        self.elapsed = 0.0
        self.error = None
        self.stopped = False
        self.initialized = False
        self.pending_signals = []

    async def checkpoint(self):
        if self.stopped:
            raise asyncio.CancelledError()
        await asyncio.sleep(0)

    async def initialize(self):
        source_map = {}
        for entry in self.sources:
            filename = str(Path(entry["filename"]).resolve())
            source_bytes = base64.b64decode(entry["source"], validate=True)
            encoding, _ = tokenize.detect_encoding(io.BytesIO(source_bytes).readline)
            source = source_bytes.decode(encoding)
            source_map[Path(filename).name.casefold()] = (filename, source)
            linecache.cache[filename] = (len(source_bytes), None, source.splitlines(True), filename)

        # Compile every file before running any initialization or event.
        prepared = []
        for obj in self.objects:
            try:
                filename, source = source_map[Path(obj.filename).name.casefold()]
            except KeyError as error:
                raise ValueError(f"{obj.filename} 파일의 실행본이 없어요.") from error
            prepared.append((obj, filename, source, compile_script(source, filename)))

        for obj, filename, source, code in prepared:
            namespace = {
                "__name__": f"__blackpy_script_{obj.id}__",
                "__file__": filename, "__package__": None,
                "__blackpy_actor__": obj,
                "__blackpy_call__": invoke,
                "__blackpy_checkpoint__": self.checkpoint,
                **obj.commands(),
            }
            obj.namespace = namespace
            obj.filename = filename
            context = EXECUTION.set((False, 0.0))
            try:
                initialization = eval(code, namespace, namespace)
                if inspect.isawaitable(initialization):
                    await initialization
            finally:
                EXECUTION.reset(context)

            for name, count in EVENT_ARGUMENTS.items():
                function = namespace.get(name)
                if function is None:
                    continue
                line = getattr(getattr(function, "__code__", None), "co_firstlineno", 1)
                try:
                    if not inspect.iscoroutinefunction(function):
                        raise TypeError("일반 def로 정의해야 합니다.")
                    if obj.is_background and name in CONTACT_EVENTS:
                        raise TypeError("배경에는 접촉 이벤트를 사용할 수 없어요.")
                    inspect.signature(function).bind(*([None] * count))
                except (TypeError, ValueError) as error:
                    raise SyntaxError(
                        f"{name}: 입력값 {count}개를 받는 일반 def로 작성해 주세요. {error}",
                        (filename, line, 1, source.splitlines()[line - 1]),
                    ) from error
                obj.handlers[name] = function
                setattr(type(obj), name, staticmethod(function))

        self.initialized = True
        for signal in self.pending_signals:
            self.broadcast(signal)
        self.pending_signals.clear()

    def start(self):
        for obj in self.objects:
            self.dispatch(obj, "시작")

    @property
    def persistent(self):
        return any(name != "시작" for obj in self.objects for name in obj.handlers)

    def dispatch(self, obj, event, args=(), delta_time=0.0):
        function = obj.handlers.get(event)
        if function is None or self.stopped:
            return None
        continuous = event in CONTINUOUS_EVENTS
        detail = args[0] if event.startswith("키_") or event == "방송_받기" else None
        guard = (obj.id, event, detail)
        if not continuous and guard in self.guards:
            return None
        if len(self.tasks) >= self.maximum_calls:
            raise RuntimeError(
                f"동시에 실행하는 함수가 {self.maximum_calls}개를 넘었어요. "
                "'중' 함수의 긴 기다리기나 반복을 확인해 주세요."
            )
        if not continuous:
            self.guards.add(guard)
        task = asyncio.create_task(self.execute(function, args, continuous, delta_time))
        self.tasks.add(task)
        task.add_done_callback(lambda done: self.finish(done, None if continuous else guard))
        return task

    async def execute(self, function, args, continuous, delta_time):
        context = EXECUTION.set((continuous, delta_time))
        try:
            await function(*args)
        except SystemExit as error:
            if error.code in (None, 0):
                self.stopped = True
            else:
                raise RuntimeError(f"코드가 종료 값 {error.code}로 끝났어요.") from error
        finally:
            EXECUTION.reset(context)

    def finish(self, task, guard):
        self.tasks.discard(task)
        if guard is not None:
            self.guards.discard(guard)
        if task.cancelled():
            return
        error = task.exception()
        if error is not None and self.error is None:
            self.error = error
            self.stopped = True

    async def animate(self, actor, x, y, heading, duration):
        if not self.initialized:
            raise RuntimeError("이동과 회전은 시작 또는 이벤트 함수 안에서 사용해 주세요.")
        if duration == 0:
            actor.apply_delta(x, y, heading)
            return
        future = asyncio.get_running_loop().create_future()
        motion = {
            "actor": actor, "x": x, "y": y, "heading": heading,
            "duration": duration, "elapsed": 0.0, "future": future,
        }
        self.motions.append(motion)
        try:
            await future
        finally:
            if motion in self.motions:
                self.motions.remove(motion)

    async def wait(self, seconds):
        if not self.initialized:
            raise RuntimeError("기다리기는 시작 또는 이벤트 함수 안에서 사용해 주세요.")
        seconds = number(seconds, "기다리는 시간", 0, 3600)
        if seconds == 0:
            await self.checkpoint()
            return
        future = asyncio.get_running_loop().create_future()
        timer = (self.elapsed + seconds, future)
        self.timers.append(timer)
        try:
            await future
        finally:
            if timer in self.timers:
                self.timers.remove(timer)

    def broadcast(self, signal):
        if not isinstance(signal, str) or not signal or len(signal) > 80:
            raise ValueError("방송 신호에는 1~80자의 이름을 넣어 주세요.")
        if not self.initialized:
            self.pending_signals.append(signal)
            return
        for obj in self.objects:
            self.dispatch(obj, "방송_받기", (signal,))

    def target(self, name):
        if not isinstance(name, str) or name not in self.by_name:
            raise ValueError(f"'{name}' 이름의 캐릭터가 없어요.")
        return self.by_name[name]

    def position_of(self, name):
        return self.target(name).position

    def heading_of(self, name):
        return self.target(name).heading

    def click_target(self, x, y):
        for actor in reversed(self.actors):
            width, height = actor.dimensions
            if (actor.visible and abs(actor.position[0] - x) <= width / 2
                    and abs(actor.position[1] - y) <= height / 2):
                return actor
        return self.background

    def key_event(self, event, key):
        for obj in self.objects:
            self.dispatch(obj, event, (key,))

    def accept(self, events):
        for event in events:
            kind = event["kind"]
            if kind == "keydown":
                key = event["key"]
                if key not in self.held_keys:
                    self.held_keys.add(key)
                    self.key_event("키_클릭", key)
            elif kind == "keyup":
                key = event["key"]
                if key in self.held_keys:
                    self.held_keys.remove(key)
                    self.key_event("키_클릭_끝", key)
            elif kind == "pointerdown":
                if self.pointer_target is None and event.get("button", "왼쪽") == "왼쪽":
                    self.pointer_target = self.click_target(event["x"], event["y"])
                    self.dispatch(self.pointer_target, "자신_클릭")
            elif kind == "pointerup":
                self.release_pointer()
            elif kind == "reset":
                for key in sorted(self.held_keys):
                    self.key_event("키_클릭_끝", key)
                self.held_keys.clear()
                self.release_pointer()

    def release_pointer(self):
        if self.pointer_target is not None:
            self.dispatch(self.pointer_target, "자신_클릭_끝")
            self.pointer_target = None

    def update_contacts(self, delta_time):
        current = {actor.id: set() for actor in self.actors}
        for index, actor in enumerate(self.actors):
            if not actor.visible:
                continue
            width, height = actor.dimensions
            for other in self.actors[index + 1:]:
                other_width, other_height = other.dimensions
                if (other.visible
                        and abs(actor.position[0] - other.position[0]) <= (width + other_width) / 2
                        and abs(actor.position[1] - other.position[1]) <= (height + other_height) / 2):
                    current[actor.id].add(other.id)
                    current[other.id].add(actor.id)

        # Build every contact snapshot before student handlers can change state.
        for actor in self.actors:
            before, after = self.contacts[actor.id], current[actor.id]
            groups = (
                ("닿았을_때", after - before),
                ("닿는_중", after),
                ("닿는_중_종료", before - after),
            )
            for event, identities in groups:
                if identities:
                    names = [other.name for other in self.actors if other.id in identities]
                    self.dispatch(actor, event, (names,), delta_time)
        self.contacts = current

    async def advance(self, delta_time, events=()):
        delta_time = number(delta_time, "프레임 시간", 0, float("inf"))
        self.elapsed += delta_time
        self.accept(events)

        for motion in list(self.motions):
            if motion["future"].done():
                continue
            previous = motion["elapsed"] / motion["duration"]
            motion["elapsed"] = min(motion["duration"], motion["elapsed"] + delta_time)
            progress = motion["elapsed"] / motion["duration"]
            step = progress - previous
            motion["actor"].apply_delta(
                motion["x"] * step, motion["y"] * step, motion["heading"] * step,
            )
            if progress >= 1:
                motion["future"].set_result(None)

        for deadline, future in list(self.timers):
            if self.elapsed + 1e-12 >= deadline and not future.done():
                future.set_result(None)

        self.update_contacts(delta_time)
        for key in sorted(self.held_keys):
            for obj in self.objects:
                self.dispatch(obj, "키_클릭_중", (key,), delta_time)
        if self.pointer_target is not None:
            self.dispatch(self.pointer_target, "자신_클릭_중", delta_time=delta_time)
        await asyncio.sleep(0)

    def snapshot(self):
        return {
            "active": True, "background": self.background_kind,
            "sprites": [actor.snapshot() for actor in self.actors],
            "message": self.message,
        }

    async def close(self):
        self.stopped = True
        pending = list(self.tasks)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        self.tasks.clear()
        self.guards.clear()
        self.motions.clear()
        self.timers.clear()

    async def run(self, transport):
        try:
            await self.initialize()
            self.start()
            previous = time.monotonic()

            while not self.stopped:
                frame_start = time.monotonic()
                events = await transport.events() if self.persistent else []
                now = time.monotonic()
                await self.advance(now - previous, events)
                previous = now
                await transport.publish(self.snapshot())
                if not self.persistent and not self.tasks:
                    break
                await asyncio.sleep(max(0, 1 / 60 - (time.monotonic() - frame_start)))

            if self.error is not None:
                raise self.error
            # A task can complete after the previous frame was captured.
            await transport.publish(self.snapshot())
        finally:
            await self.close()


class HttpTransport:
    def __init__(self):
        endpoint = urlsplit(os.environ.get("PLAYGROUND_URL", ""))
        if endpoint.scheme != "http" or endpoint.hostname != "127.0.0.1":
            raise RuntimeError("실행 프로그램의 연결 주소를 확인해 주세요.")
        self.run_id = os.environ["PLAYGROUND_RUN_ID"]
        self.headers = {
            "X-Playground-Token": os.environ["PLAYGROUND_TOKEN"],
            "Content-Type": "application/json",
        }
        self.reader = http.client.HTTPConnection(endpoint.hostname, endpoint.port, timeout=3)
        self.writer = http.client.HTTPConnection(endpoint.hostname, endpoint.port, timeout=3)

    def request(self, connection, method, path, payload=None):
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        connection.request(method, path, body=body, headers=self.headers)
        response = connection.getresponse()
        result = json.loads(response.read().decode("utf-8"))
        if response.status != 200:
            raise RuntimeError(result.get("error", "실행이 끝났어요."))
        return result

    async def events(self):
        path = "/api/events?" + urlencode({"runId": self.run_id})
        result = await asyncio.to_thread(self.request, self.reader, "GET", path)
        return result["events"]

    async def publish(self, scene):
        await asyncio.to_thread(self.request, self.writer, "POST", "/api/frame", {
            "runId": self.run_id, "scene": scene,
        })

    def close(self):
        self.reader.close()
        self.writer.close()
