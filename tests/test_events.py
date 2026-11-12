"""파일별 코드, 이벤트 전환, 프레임 호출과 오류 위치를 검증합니다."""

import asyncio
import linecache
import traceback
import unittest

from test_runtime_support import make_runtime, settle, tick


class ScriptTests(unittest.IsolatedAsyncioTestCase):
    async def prepare(self, *args, **kwargs):
        runtime = make_runtime(*args, **kwargs)
        self.addAsyncCleanup(runtime.close)
        await runtime.initialize()
        return runtime

    async def test_file_states_and_globals_are_isolated(self):
        runtime = await self.prepare(
            '점수 = 1\ndef 시작():\n    위치 = (20, 30)\n    크기 += 1\n    속도 *= 2\n',
            other_source='점수 = 9\ndef 시작():\n    위치 = (300, 40)\n',
        )
        runtime.start()
        await settle()
        cat, car = runtime.actors
        self.assertEqual(cat.position, (20, 30))
        self.assertEqual(cat.scale, 2)
        self.assertEqual(cat.speed, 2)
        self.assertEqual(car.position, (300, 40))
        self.assertEqual(cat.namespace["점수"], 1)
        self.assertEqual(car.namespace["점수"], 9)
        self.assertIsNot(type(cat), type(car))

    async def test_helpers_inherit_continuous_context(self):
        runtime = await self.prepare(
            'def 이동():\n    앞으로(100)\ndef 키_클릭_중(키):\n    이동()\n'
        )
        await tick(runtime, 0.1, [{"kind": "keydown", "key": "오른쪽"}])
        self.assertAlmostEqual(runtime.actors[0].position[0], 10)
        self.assertFalse(runtime.motions)

    async def test_nested_helpers_and_builtin_calls(self):
        runtime = await self.prepare(
            '결과 = []\ndef 시작():\n'
            '    def 두배(값):\n        return 값 * 2\n'
            '    for 값 in range(3):\n        결과.append(두배(값))\n'
            '    결과.append(sum(x for x in range(3)))\n'
        )
        runtime.start()
        for _ in range(4):
            await settle()
        self.assertEqual(runtime.actors[0].namespace["결과"], [0, 2, 4, 3])
        self.assertIsNone(runtime.error)

    async def test_normal_statements_wait_for_motion(self):
        runtime = await self.prepare('def 시작():\n    앞으로(100)\n    말하기("완료")\n')
        runtime.start()
        await settle()
        await tick(runtime, 0.25)
        self.assertEqual(runtime.actors[0].speech, "")
        await tick(runtime, 0.25)
        self.assertEqual(runtime.actors[0].speech, "완료")

    async def test_same_key_busy_is_ignored_other_key_runs(self):
        runtime = await self.prepare(
            '기록 = []\ndef 키_클릭(키):\n    기록.append(키)\n    기다리기(1)\n'
        )
        await tick(runtime, 0, [{"kind": "keydown", "key": "오른쪽"}])
        await tick(runtime, 0, [
            {"kind": "keyup", "key": "오른쪽"},
            {"kind": "keydown", "key": "오른쪽"},
            {"kind": "keydown", "key": "위"},
        ])
        self.assertEqual(runtime.actors[0].namespace["기록"], ["오른쪽", "위"])

    async def test_continuous_spawns_each_frame_and_release_does_not_cancel(self):
        runtime = await self.prepare(
            '기록 = []\ndef 키_클릭_중(키):\n'
            '    기록.append("시작")\n    기다리기(1)\n    기록.append("끝")\n'
        )
        await tick(runtime, 0.1, [{"kind": "keydown", "key": "오른쪽"}])
        await tick(runtime, 0.1)
        await tick(runtime, 0.1)
        self.assertEqual(len(runtime.tasks), 3)
        await tick(runtime, 0, [{"kind": "keyup", "key": "오른쪽"}])
        await tick(runtime, 1)
        self.assertEqual(runtime.actors[0].namespace["기록"], ["시작"] * 3 + ["끝"] * 3)

    async def test_delayed_continuous_calls_keep_their_original_delta(self):
        runtime = await self.prepare(
            'def 키_클릭_중(키):\n    기다리기(1)\n    앞으로(100)\n'
        )
        await tick(runtime, 0.1, [{"kind": "keydown", "key": "오른쪽"}])
        await tick(runtime, 0.2)
        await tick(runtime, 0, [{"kind": "keyup", "key": "오른쪽"}])
        await tick(runtime, 1)
        self.assertAlmostEqual(runtime.actors[0].position[0], 30)

    async def test_broadcast_starts_ordinary_context(self):
        runtime = await self.prepare(
            'def 키_클릭_중(키):\n    방송하기("가자")\n'
            'def 방송_받기(신호):\n    앞으로(100)\n'
        )
        await tick(runtime, 0.1, [{"kind": "keydown", "key": "오른쪽"}])
        self.assertAlmostEqual(runtime.actors[0].position[0], 0)
        self.assertEqual(len(runtime.motions), 1)
        await tick(runtime, 0.5, [{"kind": "keyup", "key": "오른쪽"}])
        self.assertAlmostEqual(runtime.actors[0].position[0], 100)

    async def test_broadcast_signal_guard_and_background_delivery(self):
        source = ('기록 = []\ndef 방송_받기(신호):\n'
                  '    기록.append(신호)\n    기다리기(1)\n')
        runtime = await self.prepare(source, source)
        runtime.broadcast("하나")
        runtime.broadcast("하나")
        runtime.broadcast("둘")
        await settle()
        for obj in runtime.objects:
            self.assertEqual(obj.namespace["기록"], ["하나", "둘"])

    async def test_click_captures_topmost_actor_until_release(self):
        source = ('기록 = []\ndef 자신_클릭():\n    기록.append("시작")\n'
                  'def 자신_클릭_중():\n    기록.append("중")\n'
                  'def 자신_클릭_끝():\n    기록.append("끝")\n')
        runtime = await self.prepare(source, source, source)
        runtime.actors[1].position = (0, 0)
        await tick(runtime, 0.1, [{"kind": "pointerdown", "x": 0, "y": 0}])
        runtime.actors[1].position = (250, 0)
        await tick(runtime, 0.1, [{"kind": "pointermove", "x": -300, "y": 200}])
        await tick(runtime, 0.1, [{"kind": "pointerup"}])
        self.assertEqual(runtime.actors[1].namespace["기록"], ["시작", "중", "중", "끝"])
        self.assertEqual(runtime.background.namespace["기록"], [])
        self.assertEqual(runtime.actors[0].namespace["기록"], [])
        await tick(runtime, 0.1, [{"kind": "pointerdown", "x": -300, "y": 200}])
        self.assertEqual(runtime.background.namespace["기록"], ["시작", "중"])

    async def test_reset_emits_releases_once(self):
        runtime = await self.prepare(
            '기록 = []\ndef 키_클릭_끝(키):\n    기록.append(키)\n'
            'def 자신_클릭_끝():\n    기록.append("마우스")\n'
        )
        await tick(runtime, 0, [
            {"kind": "keydown", "key": "위"},
            {"kind": "pointerdown", "x": 0, "y": 0},
        ])
        await tick(runtime, 0, [{"kind": "reset"}, {"kind": "reset"}])
        self.assertEqual(runtime.actors[0].namespace["기록"], ["위", "마우스"])
        self.assertFalse(runtime.held_keys)
        self.assertIsNone(runtime.pointer_target)

    async def test_contact_lists_enter_hold_exit_and_hide(self):
        runtime = await self.prepare(
            '기록 = []\ndef 닿았을_때(목록):\n    기록.append(("시작", 목록))\n'
            'def 닿는_중(목록):\n    기록.append(("중", 목록))\n'
            'def 닿는_중_종료(목록):\n    기록.append(("끝", 목록))\n',
            other_source="",
        )
        await tick(runtime)
        runtime.actors[1].position = (30, 0)
        await tick(runtime)
        await tick(runtime)
        runtime.actors[1].visible = False
        await tick(runtime)
        self.assertEqual(runtime.actors[0].namespace["기록"], [
            ("시작", ["자동차"]), ("중", ["자동차"]),
            ("중", ["자동차"]), ("끝", ["자동차"]),
        ])

    async def test_contact_end_is_not_continuous_motion(self):
        runtime = await self.prepare(
            'def 닿는_중_종료(목록):\n    앞으로(100)\n', other_source=""
        )
        runtime.actors[1].position = (0, 0)
        await tick(runtime)
        runtime.actors[1].position = (300, 0)
        await tick(runtime)
        self.assertEqual(len(runtime.motions), 1)
        self.assertEqual(runtime.actors[0].position, (0, 0))

    async def test_infinite_loop_yields_and_cancels(self):
        runtime = await self.prepare(
            '횟수 = 0\ndef 시작():\n    global 횟수\n'
            '    while True:\n        횟수 += 1\n'
            'def 키_클릭(키):\n    말하기("입력")\n'
        )
        runtime.start()
        await tick(runtime, 0.1, [{"kind": "keydown", "key": "위"}])
        self.assertGreater(runtime.actors[0].namespace["횟수"], 0)
        self.assertEqual(runtime.actors[0].speech, "입력")
        await asyncio.wait_for(runtime.close(), 1)
        self.assertFalse(runtime.tasks)

    async def test_task_cap_reports_error_instead_of_dropping(self):
        runtime = await self.prepare(
            'def 키_클릭_중(키):\n    기다리기(100)\n', maximum_calls=2
        )
        await tick(runtime, 0.1, [{"kind": "keydown", "key": "위"}])
        await tick(runtime, 0.1)
        with self.assertRaisesRegex(RuntimeError, "2개"):
            await tick(runtime, 0.1)

    async def test_error_preserves_original_file_line_and_source(self):
        runtime = await self.prepare('def 시작():\n    말하기("전")\n    1 / 0\n')
        runtime.start()
        await settle()
        self.assertIsInstance(runtime.error, ZeroDivisionError)
        frames = traceback.extract_tb(runtime.error.__traceback__)
        student = [frame for frame in frames if frame.filename.endswith("고양이.py")]
        self.assertEqual(student[-1].lineno, 3)
        self.assertIn("1 / 0", linecache.getline(student[-1].filename, 3))

    async def test_reserved_parameter_and_readonly_name_have_clear_errors(self):
        runtime = make_runtime('def 시작(위치):\n    pass\n')
        with self.assertRaisesRegex(SyntaxError, "함수 입력값"):
            await runtime.initialize()
        runtime = await self.prepare('def 시작():\n    이름 = "다른 이름"\n')
        runtime.start()
        await settle()
        self.assertIsInstance(runtime.error, ValueError)

    async def test_annotated_state_assignment_and_unpacking(self):
        runtime = await self.prepare(
            'def 시작():\n    위치: tuple = (10, 20)\n'
            '    크기, 속도 = (2, 3)\n    global 방향\n    방향 = 90\n'
        )
        runtime.start()
        await settle()
        self.assertIsNone(runtime.error)
        actor = runtime.actors[0]
        self.assertEqual((actor.position, actor.scale, actor.speed, actor.heading),
                         ((10, 20), 2, 3, 90))

    async def test_ambiguous_reserved_bindings_are_rejected(self):
        for source in (
            '값 = lambda 위치: 위치\n',
            'def 시작():\n    if (속도 := 2):\n        pass\n',
            'try:\n    1 / 0\nexcept Exception as 크기:\n    pass\n',
        ):
            with self.subTest(source=source):
                runtime = make_runtime(source)
                with self.assertRaises(SyntaxError):
                    await runtime.initialize()

    async def test_background_rejects_contact_handlers(self):
        runtime = make_runtime(background_source='def 닿는_중(목록):\n    pass\n')
        with self.assertRaisesRegex(SyntaxError, "배경에는 접촉"):
            await runtime.initialize()

    async def test_bad_signature_is_reported_before_start(self):
        runtime = make_runtime('def 키_클릭():\n    pass\n')
        with self.assertRaisesRegex(SyntaxError, "입력값 1개"):
            await runtime.initialize()

    async def test_timed_initialization_commands_fail_instead_of_hanging(self):
        for source in ('기다리기(1)\n', '앞으로(100)\n',
                       'def 시작(값=기다리기(1)):\n    pass\n'):
            with self.subTest(source=source):
                runtime = make_runtime(source)
                with self.assertRaisesRegex(RuntimeError, "함수 안"):
                    await asyncio.wait_for(runtime.initialize(), 1)

    async def test_finite_start_finishes_and_keeps_final_scene(self):
        runtime = make_runtime('def 시작():\n    말하기("완료")\n')
        scenes = []

        class Transport:
            async def events(self):
                raise AssertionError("시작만 있는 프로젝트는 입력을 기다리지 않아요.")

            async def publish(self, scene):
                scenes.append(scene)

        await asyncio.wait_for(runtime.run(Transport()), 1)
        self.assertFalse(runtime.tasks)
        self.assertEqual(scenes[-1]["sprites"][0]["speech"], "완료")


if __name__ == "__main__":
    unittest.main()
