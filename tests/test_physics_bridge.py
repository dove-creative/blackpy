"""물리 요청 중의 학생 명령, 완료 순서와 한글 상태 연결을 검증합니다."""

import asyncio
import math
import unittest

from test_runtime_support import make_runtime, settle, tick


class PhysicsBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_trigger_keyword_default_and_validation(self):
        runtime = await self.prepare('물리_설정("충돌만", 트리거=True)\n')
        actor = runtime.actors[0]
        self.assertTrue(actor.physics_snapshot()["trigger"])
        actor.set_physics("충돌만")
        self.assertFalse(actor.physics_snapshot()["trigger"])
        for value in (1, 0, "True", None):
            with self.assertRaises(TypeError):
                actor.set_physics("충돌만", value)
        runtime.background.set_physics("invalid", 트리거="ignored")
        actor.heading = 35
        self.assertEqual(actor.physics_snapshot()["heading"], 35)

    async def prepare(self, source="", other_source=None):
        runtime = make_runtime(source, other_source=other_source)
        self.addAsyncCleanup(runtime.close)
        await runtime.initialize()
        return runtime

    async def test_modes_mass_and_background_validation(self):
        runtime = await self.prepare()
        actor = runtime.actors[0]
        self.assertEqual((actor.physics, actor.mass), ("충돌만", 1))
        for value in ("정적", None, [], 1):
            with self.assertRaises(ValueError):
                actor.set_physics(value)
        for value in (0, -1, math.inf, math.nan, 0.0001, True):
            with self.assertRaises((ValueError, TypeError)):
                actor.set_mass(value)
        with self.assertRaises(ValueError):
            actor.impulse(90, 10)
        runtime.background.set_physics("물리")
        self.assertEqual(runtime.background._physics_commands, [])
        actor.set_physics("물리")
        actor.set_mass(10)
        self.assertEqual((actor.physics, actor.mass), ("물리", 10))
        self.assertTrue(runtime.persistent)

    async def test_impulse_and_stop_order_and_mode_names_compile(self):
        runtime = await self.prepare(
            '물리_설정("물리")\n무게_설정(10)\n'
            'def 시작():\n    힘_작용(90, 10)\n    정지()\n'
            '    말하기(str((물리, 무게, 닿은_객체_리스트)))\n'
        )
        runtime.start()
        await settle()
        actor = runtime.actors[0]
        commands = actor._physics_commands
        self.assertEqual([item["kind"] for item in commands[-2:]], ["impulse", "stop"])
        self.assertAlmostEqual(commands[-2]["x"], 0)
        self.assertAlmostEqual(commands[-2]["y"], 10)
        self.assertIn("물리", actor.speech)
        self.assertIsNone(runtime.error)

    async def test_rename_updates_lookup_and_contacts_without_changing_identity(self):
        runtime = await self.prepare(other_source="")
        cat, car = runtime.actors
        car.position = cat.position
        await tick(runtime)
        original_id, original_file = car.id, car.filename
        car.set_name("새 자동차")
        self.assertIs(runtime.target("새 자동차"), car)
        with self.assertRaises(ValueError):
            runtime.target("자동차")
        self.assertEqual(cat.touching_names, ["새 자동차"])
        copied = cat.touching_names
        copied.clear()
        self.assertEqual(cat.touching_names, ["새 자동차"])
        self.assertEqual((car.id, car.filename), (original_id, original_file))
        self.assertEqual(car.snapshot()["label"], "새 자동차")
        for name in ("배경", "고양이", " ", "가" * 81, "😀" * 41):
            with self.assertRaises(ValueError):
                car.set_name(name)
        self.assertEqual(car.name, "새 자동차")

    async def test_none_mode_ends_existing_contacts(self):
        runtime = await self.prepare(
            '기록 = []\ndef 닿는_중_종료(목록):\n    기록.append(목록)\n',
            other_source="",
        )
        cat, car = runtime.actors
        car.position = cat.position
        await tick(runtime)
        car.set_physics("없음")
        await tick(runtime)
        self.assertEqual(cat.touching_names, [])
        self.assertEqual(cat.namespace["기록"], [["자동차"]])

    async def test_motion_completion_reads_resolved_position(self):
        runtime = await self.prepare(
            '물리_설정("물리")\n결과 = []\ndef 시작():\n'
            '    앞으로(100)\n    결과.append(위치)\n'
        )

        async def physics_step(delta_time, actors, commands):
            return {"actors": [{"id": "actor-1", "x": 25, "y": -5, "contacts": []}]}

        runtime.physics_step = physics_step
        runtime.start()
        await settle()
        await tick(runtime, 0.5)
        self.assertEqual(runtime.actors[0].namespace["결과"], [(25, -5)])

    async def test_teleport_during_request_is_not_overwritten(self):
        runtime = await self.prepare('물리_설정("물리")\n')
        entered, release = asyncio.Event(), asyncio.Event()

        async def physics_step(delta_time, actors, commands):
            entered.set()
            await release.wait()
            return {"actors": [{"id": "actor-1", "x": 25, "y": -5, "contacts": []}]}

        runtime.physics_step = physics_step
        pending = asyncio.create_task(runtime.synchronize_physics(0.1))
        await entered.wait()
        runtime.actors[0].goto(200, 100)
        release.set()
        await pending
        actor = runtime.actors[0]
        self.assertEqual(actor.position, (200, 100))
        self.assertEqual(actor._physics_commands[0]["kind"], "teleport")

    async def test_relative_move_during_request_is_kept_for_next_step(self):
        runtime = await self.prepare('물리_설정("물리")\n')
        entered, release = asyncio.Event(), asyncio.Event()

        async def physics_step(delta_time, actors, commands):
            entered.set()
            await release.wait()
            return {"actors": [{"id": "actor-1", "x": 25, "y": -5, "contacts": []}]}

        runtime.physics_step = physics_step
        pending = asyncio.create_task(runtime.synchronize_physics(0.1))
        await entered.wait()
        runtime.actors[0].apply_delta(6, 2)
        release.set()
        await pending
        actor = runtime.actors[0]
        self.assertEqual(actor.position, (31, -3))
        self.assertEqual(actor._physics_commands[0]["kind"], "move")

    async def test_physics_never_silently_runs_without_engine(self):
        runtime = await self.prepare('물리_설정("물리")\n')
        with self.assertRaisesRegex(RuntimeError, "실행부"):
            await tick(runtime)

    async def test_mode_change_during_request_preserves_resolved_position(self):
        runtime = await self.prepare('물리_설정("물리")\n')
        entered, release = asyncio.Event(), asyncio.Event()

        async def physics_step(delta_time, actors, commands):
            entered.set()
            await release.wait()
            return {"actors": [{"id": "actor-1", "x": 25, "y": -5, "contacts": []}]}

        runtime.physics_step = physics_step
        pending = asyncio.create_task(runtime.synchronize_physics(0.1))
        await entered.wait()
        runtime.actors[0].set_physics("충돌만")
        release.set()
        await pending
        actor = runtime.actors[0]
        self.assertEqual(actor.position, (25, -5))
        self.assertEqual(actor._physics_commands[0]["mode"], "충돌만")
        self.assertEqual(actor._physics_baseline["mode"], "물리")

    async def test_settings_are_sent_in_student_order_from_previous_baseline(self):
        runtime = await self.prepare('물리_설정("물리")\n')
        received = []

        async def physics_step(delta_time, actors, commands):
            received.append((actors, commands))
            return {"actors": [{"id": "actor-1", "x": 0, "y": 0, "contacts": []}]}

        runtime.physics_step = physics_step
        await runtime.synchronize_physics(0)
        actor = runtime.actors[0]
        actor.impulse(0, 10)
        actor.set_mass(10)
        actor.set_physics("없음")
        actor.set_physics("물리")
        await runtime.synchronize_physics(0)
        baseline, commands = received[-1]
        self.assertEqual(baseline[0]["mass"], 1)
        self.assertEqual([item["kind"] for item in commands], ["impulse", "mass", "mode", "mode"])
        self.assertEqual(actor._physics_baseline["mass"], 10)
