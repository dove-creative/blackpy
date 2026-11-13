"""거리·속도 문맥, 상태 대입과 움직임 합산을 검증합니다."""

import asyncio
import math
import unittest

from test_runtime_support import make_runtime, settle, tick
from blackpy import EXECUTION, random_integer, vector_angle


class MotionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runtime = make_runtime()
        await self.runtime.initialize()
        self.actor = self.runtime.actors[0]
        self.addAsyncCleanup(self.runtime.close)

    async def test_normal_distance_waits_for_completion(self):
        movement = asyncio.create_task(self.actor.forward(100))
        await settle()
        await tick(self.runtime, 0.25)
        self.assertAlmostEqual(self.actor.position[0], 50)
        self.assertFalse(movement.done())
        await tick(self.runtime, 0.25)
        await movement
        self.assertAlmostEqual(self.actor.position[0], 100)

    async def test_normal_speed_is_captured_at_start(self):
        self.actor.speed = 2
        movement = asyncio.create_task(self.actor.forward(100))
        await settle()
        self.actor.speed = 10
        await tick(self.runtime, 0.125)
        self.assertAlmostEqual(self.actor.position[0], 50)
        await tick(self.runtime, 0.125)
        await movement

    async def test_multiple_motions_add_instead_of_overwriting(self):
        first = asyncio.create_task(self.actor.forward(100))
        second = asyncio.create_task(self.actor.forward(50))
        await settle()
        await tick(self.runtime, 0.25)
        self.assertAlmostEqual(self.actor.position[0], 100)
        await tick(self.runtime, 0.25)
        await asyncio.gather(first, second)
        self.assertAlmostEqual(self.actor.position[0], 150)

    async def test_absolute_position_retains_remaining_motion(self):
        task = asyncio.create_task(self.actor.forward(100))
        await settle()
        await tick(self.runtime, 0.25)
        self.actor.goto(1000, 20)
        await tick(self.runtime, 0.25)
        await task
        self.assertEqual(self.actor.position, (1050, 20))

    async def test_continuous_rate_is_frame_independent(self):
        for frames in (30, 60, 120):
            self.actor.position = (0, 0)
            self.actor.speed = 2
            context = EXECUTION.set((True, 1 / frames))
            try:
                for _ in range(frames):
                    await self.actor.forward(100)
            finally:
                EXECUTION.reset(context)
            self.assertAlmostEqual(self.actor.position[0], 200)
            self.assertEqual(self.runtime.motions, [])

    async def test_continuous_rotation_uses_degrees_per_second(self):
        context = EXECUTION.set((True, 0.25))
        try:
            await self.actor.left(180)
            self.assertAlmostEqual(self.actor.heading, 45)
            await self.actor.right(90)
            self.assertAlmostEqual(self.actor.heading, 22.5)
        finally:
            EXECUTION.reset(context)

    async def test_signed_motion_and_start_heading(self):
        self.actor.heading = 90
        movement = asyncio.create_task(self.actor.forward(-100))
        await settle()
        self.actor.heading = 0
        await tick(self.runtime, 0.5)
        await movement
        self.assertAlmostEqual(self.actor.position[0], 0)
        self.assertAlmostEqual(self.actor.position[1], -100)

    async def test_zero_motion_completes_without_frame(self):
        await self.actor.forward(0)
        await self.actor.left(0)
        self.assertFalse(self.runtime.motions)

    async def test_extreme_finite_speed_still_applies_full_normal_motion(self):
        self.actor.speed = 1e308
        await self.actor.forward(100)
        await self.actor.left(90)
        self.assertEqual(self.actor.position, (100, 0))
        self.assertEqual(self.actor.heading, 90)

    async def test_look_accepts_opposite_coordinate_limits(self):
        self.actor.position = (-100000, 0)
        self.actor.look(100000, 0)
        self.assertEqual(self.actor.heading, 0)

    async def test_normal_rotation_duration_and_speed(self):
        self.actor.speed = 2
        rotation = asyncio.create_task(self.actor.right(180))
        await settle()
        await tick(self.runtime, 0.25)
        self.assertAlmostEqual(self.actor.heading, 270)
        await tick(self.runtime, 0.25)
        await rotation
        self.assertAlmostEqual(self.actor.heading, 180)

    async def test_wait_uses_simulation_time(self):
        task = asyncio.create_task(self.runtime.wait(1))
        await settle()
        await tick(self.runtime, 0.75)
        self.assertFalse(task.done())
        await tick(self.runtime, 0.25)
        await task

    async def test_absolute_commands_do_not_scale_by_frame_time(self):
        context = EXECUTION.set((True, 0.001))
        try:
            self.actor.goto(100, 50)
            self.actor.look(90)
            self.assertEqual(self.actor.position, (100, 50))
            self.assertEqual(self.actor.heading, 90)
            self.actor.look(200, 50)
            self.assertEqual(self.actor.heading, 0)
        finally:
            EXECUTION.reset(context)

    async def test_state_validation_and_name_immutability(self):
        for name, value in (("speed", 0), ("speed", math.inf), ("scale", 0),
                            ("position", (1,)), ("visible", 1), ("name", "새 이름")):
            with self.subTest(name=name, value=value):
                with self.assertRaises((ValueError, TypeError)):
                    setattr(self.actor, name, value)

    async def test_background_capabilities_and_speech(self):
        background = self.runtime.background
        background.background = "city"
        background.say("무대 안내")
        self.actor.say("안녕")
        self.assertEqual(self.runtime.snapshot()["message"], "무대 안내")
        self.assertEqual(self.runtime.snapshot()["sprites"][0]["speech"], "안녕")
        await background.forward(10)
        with self.assertRaises(ValueError):
            self.actor.background = "city"

    async def test_speech_joins_values_for_actors_and_background(self):
        for target in (self.actor, self.runtime.background):
            target.say("점수", 3, 1.5, True, None, [1, 2])
        expected = "점수 3 1.5 True None [1, 2]"
        self.assertEqual(self.actor.speech, expected)
        self.assertEqual(self.runtime.message, expected)
        self.actor.say()
        self.runtime.background.say("")
        self.assertEqual(self.actor.speech, "")
        self.assertEqual(self.runtime.message, "")

    async def test_speech_validates_combined_length(self):
        for target in (self.actor, self.runtime.background):
            target.say("가" * 99, "나" * 100)
            for parts in (("가" * 201,), ("가" * 100, "나" * 100)):
                with self.assertRaises(ValueError):
                    target.say(*parts)
            displayed = self.runtime.message if target.is_background else target.speech
            self.assertEqual(displayed, "가" * 99 + " " + "나" * 100)

    async def test_background_actor_commands_have_no_effect_or_wait(self):
        background = self.runtime.background
        before = self.runtime.snapshot()
        commands = background.commands()
        calls = {
            "앞으로": (100,), "왼쪽으로돌기": (90,),
            "오른쪽으로돌기": (90,), "왼쪽_돌기": (90,),
            "오른쪽_돌기": (90,), "뒤집기": ("가로",), "좌표로": (10, 20),
            "바라보기": (90,), "속도_변경": (2,),
            "크기_바꾸기": (1,), "크기_정하기": (2,),
            "가시성_설정": (False,), "물리_설정": ("물리",),
            "무게_설정": (10,), "힘_작용": (90, 10),
            "정지": (), "이름_정하기": ("새 배경",),
        }
        for continuous in (False, True):
            context = EXECUTION.set((continuous, 0.1))
            try:
                for name, arguments in calls.items():
                    for values in (arguments, (None,) * len(arguments)):
                        with self.subTest(name=name, continuous=continuous):
                            result = commands[name](*values)
                            if asyncio.iscoroutine(result):
                                result = await asyncio.wait_for(result, 1)
                            self.assertIsNone(result)
                background.look(10, 20)
            finally:
                EXECUTION.reset(context)
        self.assertEqual(self.runtime.snapshot(), before)
        self.assertEqual(background._physics_commands, [])
        self.assertEqual(background.name, "배경")
        self.assertEqual(background._position, (0, 0))
        self.assertEqual(background._heading, 0)
        self.assertEqual(background._speed, 1)
        self.assertEqual(background._scale, 1)
        self.assertTrue(background._visible)
        self.assertEqual(background._mass, 1)
        self.assertEqual(background._physics, "충돌만")

    async def test_background_state_values_still_require_an_actor(self):
        for name in ("position", "heading", "speed", "scale", "visible",
                     "physics", "mass", "touching_names"):
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, "상태 값"):
                    getattr(self.runtime.background, name)

    async def test_lookup_and_calculations(self):
        self.actor.goto(10, 20)
        self.assertEqual(self.runtime.position_of("고양이"), (10, 20))
        self.assertEqual(self.runtime.heading_of("고양이"), 0)
        self.assertEqual(vector_angle(0, 1), 90)
        self.assertEqual(random_integer(4, 4), 4)
        with self.assertRaises(ValueError):
            self.runtime.position_of("없는 이름")
        with self.assertRaises(TypeError):
            random_integer(True, 3)


if __name__ == "__main__":
    unittest.main()
