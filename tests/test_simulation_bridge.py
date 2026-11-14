"""C# 소유 이동의 완료 순서와 오래된 입력·응답의 경계를 검증합니다."""

import asyncio
import unittest

from test_runtime_support import make_runtime, settle


def reply(runtime, **changes):
    result = {
        "tick": 1, "elapsed": 1 / 60, "completed": [], "contacts": [],
        "events": [], "keys": {}, "pointerId": None, "pointerGeneration": 0,
        "actors": [{"id": actor.id, "x": actor.position[0], "y": actor.position[1],
                    "heading": actor.heading, "contacts": [], "contactGeneration": 0}
                   for actor in runtime.actors],
    }
    result.update(changes)
    return result


class SimulationBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def prepare(self, source="", other_source=None):
        runtime = make_runtime(source, other_source=other_source)
        self.addAsyncCleanup(runtime.close)
        await runtime.initialize()
        return runtime

    async def test_start_waits_for_the_initial_scene_to_be_registered(self):
        runtime = await self.prepare('시작됨 = False\ndef 시작():\n    global 시작됨\n    시작됨 = True\n')

        async def initialized():
            return

        runtime.initialize = initialized
        exchanges = []
        test = self

        class Transport:
            async def exchange(self, scene, actors, commands, ready, completed, contact_ack):
                if not exchanges:
                    await settle()
                    test.assertFalse(runtime.actors[0].namespace["시작됨"])
                exchanges.append(ready)
                return reply(runtime)

        await runtime.run(Transport())
        self.assertTrue(runtime.actors[0].namespace["시작됨"])
        self.assertFalse(exchanges[0])
        self.assertTrue(exchanges[-1])

    async def test_motion_is_sent_once_and_resumes_with_resolved_pose(self):
        runtime = await self.prepare(
            '결과 = []\ndef 시작():\n    앞으로(100)\n    결과.append(위치)\n'
        )
        requests = []

        async def exchange(scene, actors, commands, ready, completed, contact_ack):
            requests.append((commands, list(completed)))
            result = reply(runtime)
            if len(requests) == 2:
                result["actors"][0].update(x=25, y=-5)
                result["completed"] = ["1"]
            return result

        runtime.remote_exchange = exchange
        runtime.start()
        await settle()
        await runtime.synchronize_remote(True)
        self.assertEqual(runtime.actors[0].namespace["결과"], [])
        await runtime.synchronize_remote(True)
        await settle()
        self.assertEqual(runtime.actors[0].namespace["결과"], [(25, -5)])
        await runtime.synchronize_remote(True)
        motions = [command for commands, _ in requests for command in commands
                   if command["kind"] == "motion"]
        self.assertEqual(len(motions), 1)
        self.assertEqual((motions[0]["x"], motions[0]["duration"]), (100, 0.5))
        self.assertEqual(requests[-1][1], ["1"])

    async def test_stale_reply_preserves_new_teleport_and_heading(self):
        runtime = await self.prepare()
        entered, release = asyncio.Event(), asyncio.Event()

        async def exchange(*args):
            result = reply(runtime)
            result["actors"][0].update(x=25, y=-5, heading=45)
            entered.set()
            await release.wait()
            return result

        runtime.remote_exchange = exchange
        pending = asyncio.create_task(runtime.synchronize_remote(True))
        await entered.wait()
        actor = runtime.actors[0]
        actor.goto(200, 100)
        actor.heading = 90
        release.set()
        await pending
        self.assertEqual((actor.position, actor.heading), ((200, 100), 90))
        self.assertEqual([command["kind"] for command in actor._physics_commands],
                         ["teleport", "heading"])

    async def test_next_held_callback_replaces_rate_and_sums_its_own_commands(self):
        runtime = await self.prepare(
            '움직임 = True\ndef 키_누름_중(키):\n'
            '    if 움직임:\n        앞으로(0.5)\n        앞으로(0.1)\n'
        )
        runtime.remote_exchange = object()
        runtime.key_generations = {"오른쪽": 7}
        actor = runtime.actors[0]
        actor._physics_commands = []
        runtime.dispatch(actor, "키_누름_중", ("오른쪽",), 0.1)
        await settle()
        rates = actor._physics_commands
        self.assertEqual([rate["forward"] for rate in rates], [0, 100, 120])
        self.assertEqual(len({rate["revision"] for rate in rates}), 1)
        old_revision = rates[-1]["revision"]
        actor._physics_commands = []
        actor.namespace["움직임"] = False
        runtime.dispatch(actor, "키_누름_중", ("오른쪽",), 0.1)
        await settle()
        self.assertEqual(len(actor._physics_commands), 1)
        self.assertEqual(actor._physics_commands[0]["x"], 0)
        self.assertGreater(actor._physics_commands[0]["revision"], old_revision)

    async def test_old_callback_finishes_but_cannot_move_a_repressed_key(self):
        runtime = await self.prepare(
            '완료 = []\ndef 키_누름_중(키):\n'
            '    앞으로(100)\n    기다리기(1)\n    앞으로(900)\n    완료.append(True)\n'
        )
        runtime.remote_exchange = object()
        runtime.key_generations = {"오른쪽": 7}
        actor = runtime.actors[0]
        runtime.dispatch(actor, "키_누름_중", ("오른쪽",), 0.1)
        await settle()
        actor._physics_commands = []
        runtime.key_generations = {"오른쪽": 8}
        for _, future in runtime.timers:
            future.set_result(None)
        await settle()
        self.assertEqual(actor._physics_commands, [])
        self.assertEqual(actor.namespace["완료"], [True])

    async def test_journal_delivers_enter_and_exit_after_contact_has_ended_once(self):
        runtime = await self.prepare(
            '기록 = []\ndef 닿았을_때(목록):\n    기록.append(("시작", 목록))\n'
            'def 닿는_중_종료(목록):\n    기록.append(("끝", 목록))\n',
            other_source="",
        )
        result = reply(runtime, contacts=[
            {"sequence": 1, "id": "actor-1", "kind": "enter", "others": ["actor-2"]},
            {"sequence": 2, "id": "actor-1", "kind": "exit", "others": ["actor-2"]},
        ])
        runtime.accept_remote(result, 0.5, True)
        await settle()
        runtime.accept_remote(result, 0.5, True)
        await settle()
        self.assertEqual(runtime.actors[0].namespace["기록"],
                         [("시작", ["자동차"]), ("끝", ["자동차"])])
        self.assertEqual(runtime.contact_ack, 2)

    async def test_multiple_contact_cycles_survive_one_exchange_and_waiting_handlers(self):
        runtime = await self.prepare(
            '기록 = []\ndef 닿았을_때(목록):\n'
            '    기록.append("시작")\n    기다리기(1)\n    기록.append("시작 완료")\n'
            'def 닿는_중_종료(목록):\n    기록.append("끝")\n', other_source="",
        )
        runtime.remote_exchange = object()
        result = reply(runtime, contacts=[
            {"sequence": index + 1, "id": "actor-1", "kind": kind, "others": ["actor-2"]}
            for index, kind in enumerate(("enter", "exit", "enter", "exit"))
        ])
        runtime.accept_remote(result, 0.5, True)
        await settle()
        runtime.accept_remote(result, 0.5, True)
        await settle()
        self.assertEqual(runtime.actors[0].namespace["기록"], ["시작", "끝", "시작", "끝"])
        self.assertEqual(len(runtime.timers), 2)
        for _, future in runtime.timers:
            future.set_result(None)
        await settle()
        self.assertEqual(runtime.actors[0].namespace["기록"],
                         ["시작", "끝", "시작", "끝", "시작 완료", "시작 완료"])

    async def test_slow_poll_dispatches_one_held_callback_without_tick_replay(self):
        runtime = await self.prepare('기록 = []\ndef 키_누름_중(키):\n    기록.append(키)\n')
        runtime.remote_exchange = object()
        for tick in (10, 10, 30):
            runtime.accept_remote(reply(runtime, tick=tick, keys={"오른쪽": 7}), 0.1, True)
            await settle()
        self.assertEqual(runtime.actors[0].namespace["기록"], ["오른쪽", "오른쪽"])

    async def test_current_input_snapshot_does_not_consume_queued_transitions(self):
        runtime = await self.prepare(
            '기록 = []\ndef 키_누름(키):\n    기록.append("키 시작")\n'
            'def 키_누름_끝(키):\n    기록.append("키 끝")\n'
            'def 자신_클릭():\n    기록.append("포인터 시작")\n'
            'def 자신_클릭_끝():\n    기록.append("포인터 끝")\n'
        )
        runtime.remote_exchange = object()
        # A full input batch may leave these presses for the following exchange.
        runtime.accept_remote(reply(runtime, keys={"오른쪽": 7},
                                    pointerId="actor-1", pointerGeneration=8), 0.1, True)
        await settle()
        self.assertEqual(runtime.actors[0].namespace["기록"], [])
        # By the time the presses arrive, the authoritative state can be released.
        runtime.accept_remote(reply(runtime, tick=2, events=[
            {"kind": "keydown", "key": "오른쪽", "generation": 7},
            {"kind": "pointerdown", "x": 0, "y": 0, "targetId": "actor-1", "generation": 8},
        ]), 0.1, True)
        await settle()
        runtime.accept_remote(reply(runtime, tick=3, events=[
            {"kind": "keyup", "key": "오른쪽", "generation": 7},
            {"kind": "pointerup", "generation": 8},
        ]), 0.1, True)
        await settle()
        self.assertEqual(runtime.actors[0].namespace["기록"],
                         ["키 시작", "포인터 시작", "키 끝", "포인터 끝"])
        self.assertEqual(runtime.held_keys, set())
        self.assertIsNone(runtime.pointer_target)
