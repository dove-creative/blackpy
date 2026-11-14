"""모양과 바라보는 방향을 함께 뒤집는 동작을 검증합니다."""

import unittest

from test_runtime_support import make_runtime, settle, tick


class FlipTests(unittest.IsolatedAsyncioTestCase):
    async def prepare(self, source="", **kwargs):
        runtime = make_runtime(source, **kwargs)
        self.addAsyncCleanup(runtime.close)
        await runtime.initialize()
        return runtime

    async def test_axes_reflect_heading_and_twice_restore_original(self):
        runtime = await self.prepare()
        actor = runtime.actors[0]
        actor.look(30)
        original = actor.snapshot()
        self.assertIs(original["flipHorizontal"], False)
        self.assertIs(original["flipVertical"], False)
        actor.flip("가로")
        self.assertAlmostEqual(actor.heading, 150)
        self.assertIs(actor.snapshot()["flipVertical"], True)
        actor.flip("가로")
        self.assertEqual(actor.snapshot(), original)
        actor.flip("세로")
        self.assertAlmostEqual(actor.heading, 330)
        self.assertIs(actor.snapshot()["flipVertical"], True)
        actor.flip("세로")
        self.assertEqual(actor.snapshot(), original)

    async def test_both_axes_make_a_half_turn_without_mirroring(self):
        runtime = await self.prepare()
        actor = runtime.actors[0]
        actor.look(30)
        actor.flip("가로")
        actor.flip("세로")
        self.assertAlmostEqual(actor.heading, 210)
        self.assertIs(actor.snapshot()["flipVertical"], False)
        self.assertIs(actor.snapshot()["flipHorizontal"], False)

    async def test_vertical_heading_keeps_direction_on_horizontal_flip(self):
        runtime = await self.prepare()
        actor = runtime.actors[0]
        actor.look(90)
        actor.flip("가로")
        self.assertAlmostEqual(actor.heading, 90)
        actor.flip("세로")
        self.assertAlmostEqual(actor.heading, 270)

    async def test_invalid_axes_leave_state_unchanged(self):
        runtime = await self.prepare()
        actor = runtime.actors[0]
        actor.flip("가로")
        original = actor.snapshot()
        for value in (None, 1, True, [], {}):
            with self.subTest(value=value):
                with self.assertRaisesRegex(TypeError, "가로.*세로"):
                    actor.flip(value)
        for value in ("", "좌우", "horizontal", "가로 "):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "가로.*세로"):
                    actor.flip(value)
        self.assertEqual(actor.snapshot(), original)

    async def test_flip_keeps_position_physics_mode_and_text(self):
        runtime = await self.prepare()
        actor = runtime.actors[0]
        actor.goto(20, 30)
        actor.say("고양이", 시간=None)
        before = actor.snapshot()
        physics = actor.physics_snapshot()
        actor.flip("가로")
        after = actor.snapshot()
        for name in before.keys() - {"flipVertical", "heading"}:
            self.assertEqual(after[name], before[name], name)
        moved = actor.physics_snapshot()
        for name in physics.keys() - {"heading"}:
            self.assertEqual(moved[name], physics[name], name)
        self.assertEqual(moved["heading"], 180)

    async def test_remote_flip_sends_the_new_heading(self):
        runtime = await self.prepare()
        runtime.remote_exchange = object()
        actor = runtime.actors[0]
        actor._physics_commands = []
        actor.flip("가로")
        self.assertEqual([(command["kind"], command["x"]) for command in actor._physics_commands],
                         [("heading", 180)])

    async def test_student_commands_flip_then_move_forward_to_return(self):
        runtime = await self.prepare(
            'def 시작():\n'
            '    앞으로(100)\n'
            '    뒤집기("가로")\n'
            '    앞으로(100)\n'
            '    말하기("집에 왔어요!", 시간=None)\n'
        )
        runtime.start()
        await settle()
        await tick(runtime, 0.5)
        actor = runtime.actors[0]
        self.assertIs(actor.snapshot()["flipVertical"], True)
        self.assertEqual(actor.heading, 180)
        await tick(runtime, 0.5)
        self.assertAlmostEqual(actor.position[0], 0)
        self.assertEqual(actor.speech, "집에 왔어요!")

    async def test_held_flip_turns_the_registered_movement(self):
        runtime = await self.prepare(
            'def 키_누름_중(키):\n    뒤집기("가로")\n    앞으로()\n'
        )
        await tick(runtime, 0.25, [{"kind": "keydown", "key": "스페이스"}])
        actor = runtime.actors[0]
        self.assertEqual(actor.heading, 180)
        self.assertAlmostEqual(actor.position[0], -50)

    async def test_background_ignores_invalid_axis_and_new_run_resets_flips(self):
        first = await self.prepare(
            '뒤집기("가로")\n',
            background_source='뒤집기(None)\n말하기("계속해요", 시간=None)\n',
        )
        self.assertEqual(first.message, "계속해요")
        self.assertFalse(first.background._mirrored)
        self.assertTrue(first.actors[0].snapshot()["flipVertical"])
        self.assertEqual(first.actors[0].heading, 180)
        await first.close()
        second = await self.prepare()
        self.assertFalse(second.actors[0].snapshot()["flipVertical"])
        self.assertEqual(second.actors[0].heading, 0)
