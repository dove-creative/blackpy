"""고정한 프로젝트의 프레임, 입력과 이벤트 호출을 관리합니다."""

import asyncio
import base64
from functools import partial
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

from blackpy import EXECUTION, MOVEMENT, ScriptObject, number
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
        self.remote_exchange = None
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
        self.event_keys = set()
        self.event_pointer_target = None
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
        self.input_requests = []
        self.input_sequence = 0
        self.physics_step = None
        self.key_generations = {}
        self.pointer_generation = 0
        self.contact_generations = {actor.id: 0 for actor in self.actors}
        self.input_generation = 0
        self.rate_revision = 0
        self.motion_sequence = 0
        self.remote_motions = {}
        self.completed_ack = []
        self.contact_ack = 0
        self.remote_tick = -1

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
                "input": partial(self.read_input, obj),
                **obj.commands(),
            }
            obj.namespace = namespace
            obj.filename = filename
            context = EXECUTION.set((False, 0.0))
            try:
                initialization = eval(code, namespace, namespace)
                if inspect.isawaitable(initialization):
                    await initialization
            except SystemExit as error:
                if error.code in (None, 0):
                    self.stopped = True
                    return
                raise RuntimeError(f"코드가 종료 값 {error.code}로 끝났어요.") from error
            finally:
                EXECUTION.reset(context)

            for name, count in EVENT_ARGUMENTS.items():
                function = namespace.get(name)
                if function is None or (obj.is_background and name in CONTACT_EVENTS):
                    continue
                line = getattr(getattr(function, "__code__", None), "co_firstlineno", 1)
                try:
                    if not inspect.iscoroutinefunction(function):
                        raise TypeError("일반 def로 정의해야 합니다.")
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
        return (any(name != "시작" for obj in self.objects for name in obj.handlers)
                or any(actor.physics == "물리" for actor in self.actors))

    def dispatch(self, obj, event, args=(), delta_time=0.0, queued=False):
        function = obj.handlers.get(event)
        if function is None or self.stopped:
            return None
        continuous = event in CONTINUOUS_EVENTS
        detail = args[0] if event.startswith("키_") or event == "방송_받기" else None
        guard = (obj.id, event, detail)
        guarded = not continuous and not queued
        if guarded and guard in self.guards:
            return None
        if len(self.tasks) >= self.maximum_calls:
            raise RuntimeError(
                f"동시에 실행하는 함수가 {self.maximum_calls}개를 넘었어요. "
                "'중' 함수의 긴 기다리기나 반복을 확인해 주세요."
            )
        if guarded:
            self.guards.add(guard)
        movement = self.movement_context(obj, event, args) if continuous else None
        task = asyncio.create_task(self.execute(function, args, continuous, delta_time, movement))
        self.tasks.add(task)
        task.add_done_callback(lambda done: self.finish(done, guard if guarded else None))
        return task

    async def execute(self, function, args, continuous, delta_time, movement=None):
        context = EXECUTION.set((continuous, delta_time))
        movement_token = MOVEMENT.set(movement)
        try:
            if movement is not None and self.remote_exchange is not None:
                self.send_rate(movement)
            await function(*args)
        except SystemExit as error:
            if error.code in (None, 0):
                self.stopped = True
            else:
                raise RuntimeError(f"코드가 종료 값 {error.code}로 끝났어요.") from error
        finally:
            MOVEMENT.reset(movement_token)
            EXECUTION.reset(context)

    def movement_context(self, actor, event, args):
        if event == "키_클릭_중":
            source = "key:" + args[0]
            generation = self.key_generations.get(args[0], 0)
        elif event == "자신_클릭_중":
            source, generation = "pointer", self.pointer_generation
        else:
            source = "contact:" + actor.id
            generation = self.contact_generations[actor.id]
        self.rate_revision += 1
        return {"actor": actor, "source": source, "generation": generation,
                "revision": self.rate_revision, "x": 0.0, "y": 0.0,
                "rotation": 0.0, "forward": 0.0}

    def movement_active(self, movement):
        if movement is None:
            return True
        source, generation = movement["source"], movement["generation"]
        if source.startswith("key:"):
            return self.key_generations.get(source[4:]) == generation
        if source == "pointer":
            return (self.pointer_target is movement["actor"]
                    and self.pointer_generation == generation)
        actor_id = movement["actor"].id
        return bool(self.contacts[actor_id]) and self.contact_generations[actor_id] == generation

    def send_rate(self, movement):
        if self.movement_active(movement) and not movement["actor"].is_background:
            movement["actor"].queue_physics(
                "rate", movement["x"], movement["y"], rotation=movement["rotation"],
                forward=movement["forward"],
                source=movement["source"], generation=movement["generation"],
                revision=movement["revision"],
            )

    def change_rate(self, actor, x=0.0, y=0.0, rotation=0.0, forward=0.0):
        movement = MOVEMENT.get()
        if movement is None or not self.movement_active(movement):
            return
        movement["x"] += x
        movement["y"] += y
        movement["rotation"] += rotation
        movement["forward"] += forward
        self.send_rate(movement)

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
        if self.remote_exchange is not None:
            self.motion_sequence += 1
            token = str(self.motion_sequence)
            future = asyncio.get_running_loop().create_future()
            self.remote_motions[token] = future
            actor.queue_physics("motion", x, y, token=token, rotation=heading, duration=duration)
            try:
                await future
            finally:
                self.remote_motions.pop(token, None)
            return
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

    async def read_input(self, actor, prompt="", /):
        if EXECUTION.get()[0]:
            raise RuntimeError("input은 매 프레임 실행되는 '중' 이벤트 대신 시작 또는 일반 이벤트에서 사용해 주세요.")
        if self.stopped:
            raise asyncio.CancelledError()

        message = str(prompt)
        if len(message.encode("utf-16-le", errors="surrogatepass")) > 4000:
            raise ValueError("input 질문은 2,000자 이내로 작성해 주세요.")
        if len(self.input_requests) >= self.maximum_calls or self.input_sequence >= 2147483647:
            raise RuntimeError("입력 요청이 너무 많아요. 반복문과 이벤트를 확인해 주세요.")

        self.input_sequence += 1
        future = asyncio.get_running_loop().create_future()
        request = {
            "id": self.input_sequence, "message": message,
            "actor": actor.name, "future": future,
        }
        self.input_requests.append(request)
        try:
            return await future
        finally:
            if request in self.input_requests:
                self.input_requests.remove(request)

    def accept_answer(self, event):
        if not self.input_requests:
            return
        request = self.input_requests[0]
        text = event.get("text")
        if (type(event.get("promptId")) is not int or event["promptId"] != request["id"]
                or not isinstance(text, str) or "\r" in text or "\n" in text
                or len(text.encode("utf-16-le", errors="surrogatepass")) > 8192):
            return

        self.input_requests.pop(0)
        if not request["future"].done():
            print(request["message"] + text, flush=True)
            request["future"].set_result(text)

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

    def rename(self, actor, name):
        if (not isinstance(name, str) or not name.strip()
                or len(name.encode("utf-16-le", errors="surrogatepass")) > 160):
            raise ValueError("이름에는 1~80자의 비어 있지 않은 문자열을 넣어 주세요.")
        if name == actor.name:
            return
        if name in self.by_name:
            raise ValueError("배경과 캐릭터 이름은 서로 다르게 정해 주세요.")
        del self.by_name[actor.name]
        actor._name = name
        self.by_name[name] = actor

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
            if kind == "answer":
                self.accept_answer(event)
            elif not self.initialized:
                continue
            elif kind == "keydown":
                key = event["key"]
                if key not in self.event_keys:
                    self.event_keys.add(key)
                    if self.remote_exchange is None:
                        self.input_generation += 1
                        self.key_generations[key] = event.get("generation", self.input_generation)
                    self.key_event("키_클릭", key)
            elif kind == "keyup":
                key = event["key"]
                if key in self.event_keys:
                    self.event_keys.remove(key)
                    if self.remote_exchange is None:
                        self.key_generations.pop(key, None)
                    self.key_event("키_클릭_끝", key)
            elif kind == "pointerdown":
                if self.event_pointer_target is None and event.get("button", "왼쪽") == "왼쪽":
                    self.event_pointer_target = next(
                        (obj for obj in self.objects if obj.id == event.get("targetId")),
                        self.click_target(event["x"], event["y"]),
                    )
                    if self.remote_exchange is None:
                        self.input_generation += 1
                        self.pointer_generation = event.get("generation", self.input_generation)
                    self.dispatch(self.event_pointer_target, "자신_클릭")
            elif kind == "pointerup":
                self.release_pointer()
            elif kind == "reset":
                for key in sorted(self.event_keys):
                    self.key_event("키_클릭_끝", key)
                self.event_keys.clear()
                if self.remote_exchange is None:
                    self.key_generations.clear()
                self.release_pointer()

        # Queued transitions can lag behind the server's current movement state.
        if self.remote_exchange is None:
            self.held_keys = set(self.event_keys)
            self.pointer_target = self.event_pointer_target

    def release_pointer(self):
        if self.event_pointer_target is not None:
            self.dispatch(self.event_pointer_target, "자신_클릭_끝")
            self.event_pointer_target = None

    def local_contacts(self):
        # Standalone event tests retain the existing non-physical overlap model.
        # The running application always obtains contacts from the C# engine.
        current = {actor.id: set() for actor in self.actors}
        for index, actor in enumerate(self.actors):
            if not actor.visible or actor.physics == "없음":
                continue
            width, height = actor.dimensions
            for other in self.actors[index + 1:]:
                other_width, other_height = other.dimensions
                if (other.visible and other.physics != "없음"
                        and abs(actor.position[0] - other.position[0]) <= (width + other_width) / 2
                        and abs(actor.position[1] - other.position[1]) <= (height + other_height) / 2):
                    current[actor.id].add(other.id)
                    current[other.id].add(actor.id)

        return current

    async def synchronize_physics(self, delta_time):
        if self.physics_step is None:
            if any(actor.physics == "물리" for actor in self.actors):
                raise RuntimeError("물리 기능은 BlackPy 실행부와 연결된 무대에서 사용해 주세요.")
            for actor in self.actors:
                actor._physics_commands.clear()
                actor._physics_baseline = actor.physics_snapshot()
            return self.local_contacts()

        snapshots = [actor.physics_snapshot() for actor in self.actors]
        baselines = [actor._physics_baseline for actor in self.actors]
        commands = []
        revisions = []
        for actor, sent in zip(self.actors, snapshots):
            commands.extend(actor._physics_commands)
            actor._physics_commands = []
            revisions.append(actor._absolute_revision)
            actor._physics_baseline = sent

        result = await self.physics_step(delta_time, baselines, commands)
        by_id = {state["id"]: state for state in result["actors"]}
        for actor, sent, revision in zip(self.actors, snapshots, revisions):
            resolved = by_id[actor.id]
            if actor._absolute_revision == revision:
                # Preserve commands that ran while the HTTP request was waiting.
                actor._position = (
                    actor._position[0] + (resolved["x"] - sent["x"]),
                    actor._position[1] + (resolved["y"] - sent["y"]),
                )

        active = {actor.id for actor in self.actors if actor.visible and actor.physics != "없음"}
        return {
            actor.id: set(by_id[actor.id]["contacts"]) & active if actor.id in active else set()
            for actor in self.actors
        }

    def update_contacts(self, delta_time, current):

        # Build every contact snapshot before student handlers can change state.
        for actor in self.actors:
            before, after = self.contacts[actor.id], current[actor.id]
            if before != after:
                self.contact_generations[actor.id] += 1
            groups = (
                ("닿았을_때", after - before),
                ("닿는_중", after),
                ("닿는_중_종료", before - after),
            )
            for event, identities in groups:
                if identities:
                    names = [other.name for other in self.actors if other.id in identities]
                    self.dispatch(actor, event, (names,), delta_time, queued=True)
        self.contacts = current

    async def advance(self, delta_time, events=()):
        delta_time = number(delta_time, "프레임 시간", 0, float("inf"))
        self.elapsed += delta_time
        self.accept(events)
        completed = []

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
                completed.append(motion["future"])

        for deadline, future in list(self.timers):
            if self.elapsed + 1e-12 >= deadline and not future.done():
                completed.append(future)

        current = await self.synchronize_physics(delta_time)
        for future in completed:
            if not future.done():
                future.set_result(None)
        self.update_contacts(delta_time, current)
        for key in sorted(self.held_keys):
            for obj in self.objects:
                self.dispatch(obj, "키_클릭_중", (key,), delta_time)
        if self.pointer_target is not None:
            self.dispatch(self.pointer_target, "자신_클릭_중", delta_time=delta_time)
        await asyncio.sleep(0)

    def snapshot(self):
        prompt = self.input_requests[0] if self.input_requests else None
        return {
            "active": True, "background": self.background_kind,
            "sprites": [actor.snapshot() for actor in self.actors],
            "message": self.message,
            "textInput": None if prompt is None else {
                key: prompt[key] for key in ("id", "message", "actor")
            },
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
        for request in self.input_requests:
            request["future"].cancel()
        self.input_requests.clear()
        for future in self.remote_motions.values():
            future.cancel()
        self.remote_motions.clear()

    async def run(self, transport):
        self.remote_exchange = getattr(transport, "exchange", None)
        if self.remote_exchange is not None:
            await self.run_remote()
            return
        self.physics_step = getattr(transport, "physics_step", None)
        initialization = asyncio.create_task(self.initialize())
        try:
            started = False
            previous = time.perf_counter()
            next_frame = previous
            frame_interval = 1 / 60

            while not self.stopped:
                await asyncio.sleep(0)
                if initialization.done() and not started:
                    await initialization
                    self.start()
                    started = True

                events = await transport.events() if (
                    self.persistent or self.input_requests or not started
                ) else []
                if initialization.done() and not started:
                    await initialization
                    self.start()
                    started = True

                now = time.perf_counter()
                if started:
                    await self.advance(now - previous, events)
                else:
                    self.accept(events)
                previous = now
                await transport.publish(self.snapshot())
                if started and not self.persistent and not self.tasks:
                    break
                # Keep short scheduler delays from shifting every later frame.
                next_frame += frame_interval
                now = time.perf_counter()
                if now - next_frame >= frame_interval:
                    # Resume from a long stall without replaying missed frames.
                    next_frame = now
                delay = next_frame - now
                if delay > 0:
                    # Windows IOCP timeouts are coarse; sleep off-loop without blocking input tasks.
                    await asyncio.to_thread(time.sleep, delay)
                else:
                    await asyncio.sleep(0)

            if self.error is not None:
                raise self.error
            # A task can complete after the previous frame was captured.
            if self.initialized and not self.stopped:
                await self.synchronize_physics(0)
            await transport.publish(self.snapshot())
        finally:
            initialization.cancel()
            await asyncio.gather(initialization, return_exceptions=True)
            await self.close()

    async def synchronize_remote(self, ready):
        positions = [(actor._position, actor._absolute_revision, actor._heading_revision)
                     for actor in self.actors]
        baselines = [actor._physics_baseline for actor in self.actors]
        commands = []
        for actor in self.actors:
            commands.extend(actor._physics_commands)
            actor._physics_commands = []
            actor._physics_baseline = actor.physics_snapshot()
        result = await self.remote_exchange(
            self.snapshot(), baselines, commands, ready, self.completed_ack, self.contact_ack,
        )
        by_id = {state["id"]: state for state in result["actors"]}
        for actor, (sent_position, position_revision, heading_revision) in zip(self.actors, positions):
            state = by_id[actor.id]
            if actor._absolute_revision == position_revision:
                actor._position = (
                    actor._position[0] + state["x"] - sent_position[0],
                    actor._position[1] + state["y"] - sent_position[1],
                )
            if actor._heading_revision == heading_revision:
                actor._heading = state["heading"] % 360
            self.contacts[actor.id] = set(state["contacts"])
            self.contact_generations[actor.id] = state["contactGeneration"]

        # Resume student statements only after the authoritative pose is visible.
        self.completed_ack = list(result["completed"])
        for token in self.completed_ack:
            future = self.remote_motions.get(token)
            if future is not None and not future.done():
                future.set_result(None)
        return result

    def accept_remote(self, result, delta_time, started):
        self.accept(result["events"])
        if not started:
            return
        self.key_generations = dict(result["keys"])
        self.held_keys = set(self.key_generations)
        self.pointer_target = next(
            (obj for obj in self.objects if obj.id == result.get("pointerId")), None,
        )
        self.pointer_generation = result["pointerGeneration"]

        objects = {actor.id: actor for actor in self.actors}
        for contact in result["contacts"]:
            if contact["sequence"] <= self.contact_ack:
                continue
            self.contact_ack = contact["sequence"]
            names = [actor.name for actor in self.actors if actor.id in contact["others"]]
            event = "닿았을_때" if contact["kind"] == "enter" else "닿는_중_종료"
            if names:
                self.dispatch(objects[contact["id"]], event, (names,), delta_time, queued=True)

        if result["tick"] <= self.remote_tick:
            return
        self.remote_tick = result["tick"]
        for actor in self.actors:
            names = actor.touching_names
            if names:
                self.dispatch(actor, "닿는_중", (names,), delta_time)
        for key in sorted(self.held_keys):
            for obj in self.objects:
                self.dispatch(obj, "키_클릭_중", (key,), delta_time)
        if self.pointer_target is not None:
            self.dispatch(self.pointer_target, "자신_클릭_중", delta_time=delta_time)

    async def run_remote(self):
        initialization = asyncio.create_task(self.initialize())
        try:
            started = False
            previous = time.perf_counter()
            next_poll = previous
            poll_interval = 1 / 60
            while not self.stopped:
                await asyncio.sleep(0)
                if initialization.done() and not started:
                    await initialization
                result = await self.synchronize_remote(started)
                if initialization.done() and not started:
                    await initialization
                    self.start()
                    started = True
                now = time.perf_counter()
                delta_time, previous = now - previous, now
                self.elapsed += delta_time
                for deadline, future in list(self.timers):
                    if self.elapsed + 1e-12 >= deadline and not future.done():
                        future.set_result(None)
                self.accept_remote(result, delta_time, started)
                await asyncio.sleep(0)
                if started and not self.persistent and not self.tasks:
                    break
                next_poll += poll_interval
                now = time.perf_counter()
                if now - next_poll >= poll_interval:
                    next_poll = now
                if next_poll > now:
                    await asyncio.to_thread(time.sleep, next_poll - now)
                else:
                    await asyncio.sleep(0)
            if self.error is not None:
                raise self.error
            if self.initialized and not self.stopped:
                await self.synchronize_remote(started)
        finally:
            initialization.cancel()
            await asyncio.gather(initialization, return_exceptions=True)
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
        self.sequence = 0

    async def exchange(self, scene, actors, commands, ready, acknowledged_completions, contact_ack):
        self.sequence += 1
        return await asyncio.to_thread(self.request, self.writer, "POST", "/api/simulation/exchange", {
            "runId": self.run_id, "sequence": self.sequence, "ready": ready,
            "scene": scene, "actors": actors, "commands": commands,
            "acknowledgedCompletions": acknowledged_completions, "contactAck": contact_ack,
        })

    async def physics_step(self, delta_time, actors, commands):
        return await asyncio.to_thread(self.request, self.writer, "POST", "/api/physics/step", {
            "runId": self.run_id, "deltaTime": delta_time,
            "actors": actors, "commands": commands,
        })

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
