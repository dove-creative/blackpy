"""모양 뒤집기와 이동·물리 상태의 분리를 검증합니다."""

import unittest

from test_runtime_support import make_runtime, settle, tick


class FlipTests(unittest.IsolatedAsyncioTestCase):
    async def prepare(self, source="", **kwargs):
        runtime = make_runtime(source, **kwargs)
        self.addAsyncCleanup(runtime.close)
        await runtime.initialize()
        return runtime

    async def test_axes_toggle_independently_and_twice_restore_original(self):
        runtime = await self.prepare()
        actor = runtime.actors[0]
        original = actor.snapshot()
        self.assertIs(original["flipHorizontal"], False)
        self.assertIs(original["flipVertical"], False)
        actor.flip("가로")
        self.assertIs(actor.snapshot()["flipHorizontal"], True)
        self.assertIs(actor.snapshot()["flipVertical"], False)
        actor.flip("세로")
        self.assertIs(actor.snapshot()["flipHorizontal"], True)
        self.assertIs(actor.snapshot()["flipVertical"], True)
        actor.flip("가로")
        self.assertIs(actor.snapshot()["flipHorizontal"], False)
        self.assertIs(actor.snapshot()["flipVertical"], True)
        actor.flip("세로")
        self.assertEqual(actor.snapshot(), original)

    async def test_invalid_axes_leave_both_flags_unchanged(self):
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

    async def test_flip_does_not_change_motion_physics_or_text(self):
        runtime = await self.prepare()
        actor = runtime.actors[0]
        actor.goto(20, 30)
        actor.look(90)
        actor.say("고양이")
        before = actor.snapshot()
        physics = actor.physics_snapshot()
        commands = list(actor._physics_commands)
        actor.flip("가로")
        actor.flip("세로")
        self.assertEqual(actor.physics_snapshot(), physics)
        self.assertEqual(actor._physics_commands, commands)
        after = actor.snapshot()
        for name in before.keys() - {"flipHorizontal", "flipVertical"}:
            self.assertEqual(after[name], before[name], name)

    async def test_student_commands_flip_then_move_back_without_changing_heading(self):
        runtime = await self.prepare(
            'def 시작():\n'
            '    앞으로(100)\n'
            '    뒤집기("가로")\n'
            '    앞으로(-100)\n'
            '    말하기("집에 왔어요!")\n'
        )
        runtime.start()
        await settle()
        await tick(runtime, 0.5)
        self.assertIs(runtime.actors[0].snapshot()["flipHorizontal"], True)
        await tick(runtime, 0.5)
        actor = runtime.actors[0]
        self.assertAlmostEqual(actor.position[0], 0)
        self.assertEqual(actor.heading, 0)
        self.assertEqual(actor.speech, "집에 왔어요!")

    async def test_background_ignores_invalid_axis_and_new_run_resets_flips(self):
        first = await self.prepare(
            '뒤집기("가로")\n뒤집기("세로")\n',
            background_source='뒤집기(None)\n말하기("계속해요")\n',
        )
        self.assertEqual(first.message, "계속해요")
        self.assertFalse(first.background._flip_horizontal)
        self.assertFalse(first.background._flip_vertical)
        self.assertTrue(first.actors[0].snapshot()["flipHorizontal"])
        await first.close()
        second = await self.prepare()
        self.assertFalse(second.actors[0].snapshot()["flipHorizontal"])
        self.assertFalse(second.actors[0].snapshot()["flipVertical"])
