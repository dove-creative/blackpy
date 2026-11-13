"""말하기의 표시 시간, 이벤트 진행과 겹친 메시지의 수명을 검증합니다."""

import inspect
import math
import unittest

from test_runtime_support import make_runtime, settle, tick


class SpeechTests(unittest.IsolatedAsyncioTestCase):
    async def prepare(self, source="", background=False, other_source=None):
        runtime = make_runtime(
            actor_source="" if background else source,
            background_source=source if background else "",
            other_source=other_source,
        )
        self.addAsyncCleanup(runtime.close)
        await runtime.initialize()
        target = runtime.background if background else runtime.actors[0]
        return runtime, target

    def displayed(self, runtime, target):
        return runtime.message if target.is_background else target.speech

    async def test_key_speech_clears_before_next_statement(self):
        source = (
            "기록 = []\n"
            "def 키_클릭(누른_키):\n"
            '    말하기(누른_키, "키를 눌렀구나!", 시간=0.5)\n'
            '    기록.append("끝")\n'
        )

        for background in (False, True):
            with self.subTest(background=background):
                runtime, target = await self.prepare(source, background)
                runtime.dispatch(target, "키_클릭", ("오른쪽",))
                await settle()
                self.assertEqual(
                    self.displayed(runtime, target), "오른쪽 키를 눌렀구나!"
                )
                self.assertEqual(target.namespace["기록"], [])
                await tick(runtime, 0.25)
                self.assertEqual(target.namespace["기록"], [])
                self.assertTrue(self.displayed(runtime, target))
                await tick(runtime, 0.25)
                self.assertEqual(self.displayed(runtime, target), "")
                self.assertEqual(target.namespace["기록"], ["끝"])
                self.assertFalse(runtime.timers)
                self.assertIsNone(runtime.error)

    async def test_timed_speech_does_not_block_other_events_or_actors(self):
        runtime, actor = await self.prepare(
            '기록 = []\ndef 시작():\n    말하기("잠깐", 시간=0.5)\n'
            '    기록.append("끝")\n'
            'def 자신_클릭():\n    기록.append("클릭")\n',
            other_source='def 시작():\n    앞으로(100)\n    말하기("도착")\n',
        )
        runtime.start()
        await settle()
        runtime.dispatch(actor, "자신_클릭")
        await settle()
        self.assertEqual(actor.namespace["기록"], ["클릭"])
        await tick(runtime, 0.25)
        self.assertEqual(actor.speech, "잠깐")
        self.assertAlmostEqual(runtime.actors[1].position[0], 250)
        await tick(runtime, 0.25)
        self.assertEqual(actor.speech, "")
        self.assertEqual(actor.namespace["기록"], ["클릭", "끝"])
        self.assertEqual(runtime.actors[1].speech, "도착")
        self.assertIsNone(runtime.error)

    async def test_old_timer_preserves_new_speech_even_if_equal(self):
        for background in (False, True):
            for replacement in ("처음 말", "새로운 말"):
                with self.subTest(background=background, text=replacement):
                    runtime, target = await self.prepare(
                        'def 시작():\n    말하기("처음 말", 시간=0.5)\n'
                        "def 키_클릭(내용):\n    말하기(내용)\n",
                        background,
                    )
                    runtime.start()
                    await settle()
                    await tick(runtime, 0.25)
                    runtime.dispatch(target, "키_클릭", (replacement,))
                    await settle()
                    await tick(runtime, 0.25)
                    self.assertEqual(
                        self.displayed(runtime, target), replacement
                    )
                    self.assertFalse(runtime.timers)
                    self.assertIsNone(runtime.error)

    async def test_latest_timed_message_keeps_its_own_deadline(self):
        for background in (False, True):
            with self.subTest(background=background):
                runtime, target = await self.prepare(
                    'def 시작():\n    말하기("앞의 말", 시간=0.5)\n'
                    'def 자신_클릭():\n    말하기("뒤의 말", 시간=0.75)\n',
                    background,
                )
                runtime.start()
                await settle()
                await tick(runtime, 0.25)
                runtime.dispatch(target, "자신_클릭")
                await settle()
                await tick(runtime, 0.25)
                self.assertEqual(self.displayed(runtime, target), "뒤의 말")
                await tick(runtime, 0.49)
                self.assertEqual(self.displayed(runtime, target), "뒤의 말")
                await tick(runtime, 0.01)
                self.assertEqual(self.displayed(runtime, target), "")
                self.assertFalse(runtime.timers)
                self.assertIsNone(runtime.error)

    async def test_invalid_duration_preserves_the_existing_message(self):
        invalid_times = (
            True, False, -0.1, 3600.1, math.inf, -math.inf, math.nan, "1", [],
        )

        for background in (False, True):
            runtime, target = await self.prepare(background=background)
            target.say("유지할 말")

            for seconds in invalid_times:
                with self.subTest(background=background, seconds=seconds):
                    with self.assertRaises((TypeError, ValueError)):
                        result = target.say("바꾸지 않음", 시간=seconds)

                        if inspect.isawaitable(result):
                            await result

                    self.assertEqual(
                        self.displayed(runtime, target), "유지할 말"
                    )
                    self.assertFalse(runtime.timers)

    async def test_positional_values_and_none_time_stay_visible(self):
        runtime, target = await self.prepare(
            'def 시작():\n    말하기("점수", 1.5, True, None, 시간=None)\n'
        )
        runtime.start()
        await settle()
        await tick(runtime, 5)
        self.assertEqual(target.speech, "점수 1.5 True None")
        self.assertFalse(runtime.timers)
        self.assertIsNone(runtime.error)

    async def test_zero_seconds_finishes_without_time_advance(self):
        for background in (False, True):
            with self.subTest(background=background):
                runtime, target = await self.prepare(
                    'def 시작():\n    말하기("잠깐", 시간=0.0)\n'
                    '    말하기("다음 줄")\n',
                    background,
                )
                runtime.start()
                await settle()
                self.assertEqual(self.displayed(runtime, target), "다음 줄")
                self.assertEqual(runtime.elapsed, 0)
                self.assertFalse(runtime.timers)
                self.assertIsNone(runtime.error)

    async def test_initialization_error_preserves_prior_speech(self):
        source = '말하기("유지할 말")\n말하기("실행 전", 시간=0.5)\n'

        for background in (False, True):
            with self.subTest(background=background):
                runtime = make_runtime(
                    actor_source="" if background else source,
                    background_source=source if background else "",
                )
                self.addAsyncCleanup(runtime.close)

                with self.assertRaises(RuntimeError):
                    await runtime.initialize()

                target = (
                    runtime.background if background else runtime.actors[0]
                )
                self.assertEqual(self.displayed(runtime, target), "유지할 말")
                self.assertFalse(runtime.timers)

    async def test_stop_cancels_long_speech_without_affecting_a_new_run(self):
        runtime, target = await self.prepare(
            'def 시작():\n    말하기("기다림", 시간=3600)\n'
            '    말하기("실행되면 안 되는 말")\n'
        )
        runtime.start()
        await settle()
        self.assertEqual(target.speech, "기다림")
        tasks = list(runtime.tasks)
        self.assertTrue(tasks)
        self.assertTrue(runtime.timers)
        await runtime.close()
        self.assertFalse(runtime.tasks)
        self.assertFalse(runtime.timers)
        self.assertTrue(all(task.cancelled() for task in tasks))

        fresh, fresh_target = await self.prepare(
            'def 시작():\n    말하기("새 실행")\n'
        )
        fresh.start()
        await settle()
        await tick(fresh, 3600)
        self.assertEqual(fresh_target.speech, "새 실행")
        self.assertIsNone(fresh.error)


if __name__ == "__main__":
    unittest.main()
