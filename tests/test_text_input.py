"""웹 텍스트 입력의 반환값, 대기 순서와 실행 종료를 검증합니다."""

import asyncio
from contextlib import redirect_stdout
import io
import unittest

from test_runtime_support import make_runtime, settle, tick


class TextInputTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.console = io.StringIO()
        capture = redirect_stdout(self.console)
        capture.__enter__()
        self.addCleanup(capture.__exit__, None, None, None)

    async def prepare(self, source, **kwargs):
        runtime = make_runtime(source, **kwargs)
        self.addAsyncCleanup(runtime.close)
        await runtime.initialize()
        runtime.start()
        await settle()
        return runtime

    def answer(self, runtime, text, prompt_id=None):
        prompt = runtime.snapshot()["textInput"]
        runtime.accept([{
            "kind": "answer", "text": text,
            "promptId": prompt["id"] if prompt_id is None else prompt_id,
        }])

    async def test_nested_helper_returns_exact_text_and_numeric_conversion(self):
        runtime = await self.prepare(
            '결과 = []\ndef 질문():\n    return input("몇 칸?")\n'
            'def 시작():\n    결과.append(int(질문()) + 3)\n'
            '    결과.append(input())\n    결과.append(input(123))\n'
        )
        self.assertEqual(runtime.snapshot()["textInput"]["message"], "몇 칸?")
        self.answer(runtime, "12")
        await settle()
        self.assertEqual(runtime.snapshot()["textInput"]["message"], "")
        self.answer(runtime, "")
        await settle()
        self.assertEqual(runtime.snapshot()["textInput"]["message"], "123")
        self.answer(runtime, "  한글 😀  ")
        await settle()
        self.assertEqual(runtime.actors[0].namespace["결과"], [15, "", "  한글 😀  "])
        self.assertIsNone(runtime.snapshot()["textInput"])

    async def test_concurrent_requests_are_fifo_and_invalid_answers_do_not_consume(self):
        runtime = await self.prepare(
            'def 시작():\n    말하기(input("첫 질문"))\n',
            other_source='def 시작():\n    말하기(input("두 번째"))\n',
        )
        first = runtime.snapshot()["textInput"]
        self.assertEqual(first["actor"], "고양이")
        for text, prompt_id in (("wrong", first["id"] + 1), (None, first["id"]),
                                ("a\nb", first["id"]), ("x" * 4097, first["id"]),
                                ("wrong", True)):
            self.answer(runtime, text, prompt_id)
            self.assertEqual(runtime.snapshot()["textInput"], first)
        self.answer(runtime, "첫 답")
        self.answer(runtime, "중복 답", first["id"])
        await settle()
        self.assertEqual(runtime.snapshot()["textInput"]["actor"], "자동차")
        self.answer(runtime, "둘째 답")
        await settle()
        self.assertEqual([actor.speech for actor in runtime.actors], ["첫 답", "둘째 답"])

    async def test_game_events_and_motion_continue_while_waiting(self):
        runtime = await self.prepare(
            'def 시작():\n    말하기(input("질문"))\n'
            'def 키_누름(키):\n    앞으로(20)\n',
        )
        await tick(runtime, 0, [{"kind": "keydown", "key": "오른쪽"}])
        await tick(runtime, 0.1)
        self.assertEqual(runtime.actors[0].position, (20, 0))
        self.assertIsNotNone(runtime.snapshot()["textInput"])

    async def test_accepted_answer_echoes_once_before_the_next_statement(self):
        runtime = await self.prepare(
            'def 시작():\n    대답 = input("질문: ")\n    print("결과", repr(대답))\n',
        )
        prompt_id = runtime.snapshot()["textInput"]["id"]
        output = io.StringIO()
        with redirect_stdout(output):
            self.answer(runtime, "  한글 <b>  ")
            runtime.accept([{"kind": "answer", "promptId": prompt_id, "text": "중복"}])
            await settle()

        self.assertEqual(output.getvalue(), "질문:   한글 <b>  \n결과 '  한글 <b>  '\n")

    async def test_continuous_helper_input_fails_without_enqueuing(self):
        runtime = await self.prepare(
            'def 질문():\n    return input("질문")\n'
            'def 키_누름_중(키):\n    질문()\n',
        )
        await tick(runtime, 0.1, [{"kind": "keydown", "key": "오른쪽"}])
        self.assertIsInstance(runtime.error, RuntimeError)
        self.assertIn("일반 이벤트", str(runtime.error))
        self.assertIsNone(runtime.snapshot()["textInput"])

    async def test_prompt_limit_and_positional_only_signature(self):
        for call, error_type in (
            ('input("😀" * 1001)', ValueError),
            ('input(prompt="질문")', TypeError),
            ('input("첫째", "둘째")', TypeError),
        ):
            with self.subTest(call=call):
                runtime = await self.prepare(f"def 시작():\n    {call}\n")
                self.assertIsInstance(runtime.error, error_type)
                self.assertIsNone(runtime.snapshot()["textInput"])

    async def test_close_cancels_all_waiters_and_clears_questions(self):
        runtime = await self.prepare(
            'def 시작():\n    input("첫째")\n',
            other_source='def 시작():\n    input("둘째")\n',
        )
        tasks = list(runtime.tasks)
        await runtime.close()
        self.assertTrue(all(task.cancelled() for task in tasks))
        self.assertIsNone(runtime.snapshot()["textInput"])

    async def test_run_pumps_top_level_input_before_start_events(self):
        runtime = make_runtime(
            '대답 = int(input("초기값"))\n'
            'def 시작():\n    말하기(str(대답 + int(input("더할 값"))), 시간=None)\n',
        )
        transport = AnsweringTransport(["10", "2"])
        await asyncio.wait_for(runtime.run(transport), timeout=2)
        self.assertEqual(runtime.actors[0].speech, "12")
        self.assertEqual(transport.questions, ["초기값", "더할 값"])
        self.assertIsNone(transport.scenes[-1]["textInput"])

    async def test_cancelling_run_during_initialization_removes_prompt(self):
        runtime = make_runtime('대답 = input("초기값")\n')
        transport = AnsweringTransport([])
        task = asyncio.create_task(runtime.run(transport))
        await settle()
        self.assertIsNotNone(runtime.snapshot()["textInput"])
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertIsNone(runtime.snapshot()["textInput"])

    async def test_initialization_finishing_during_poll_starts_before_key_event(self):
        runtime = make_runtime(
            '기록 = []\nfor 값 in range(2):\n    pass\n'
            'def 시작():\n    기록.append("시작")\n'
            'def 키_누름(키):\n    기록.append("키")\n',
        )

        class DelayedTransport(AnsweringTransport):
            async def events(self):
                await settle()
                await settle()
                return [{"kind": "keydown", "key": "오른쪽"}]

            async def publish(self, scene):
                await super().publish(scene)
                if runtime.actors[0].namespace.get("기록") == ["시작", "키"]:
                    runtime.stopped = True

        await asyncio.wait_for(runtime.run(DelayedTransport([])), timeout=2)
        self.assertEqual(runtime.actors[0].namespace["기록"], ["시작", "키"])


class AnsweringTransport:
    def __init__(self, answers):
        self.answers = list(answers)
        self.scenes = []
        self.questions = []
        self.pending = []
        self.last_prompt_id = None

    async def events(self):
        events, self.pending = self.pending, []
        return events

    async def publish(self, scene):
        self.scenes.append(scene)
        prompt = scene["textInput"]
        if prompt and prompt["id"] != self.last_prompt_id:
            self.last_prompt_id = prompt["id"]
            self.questions.append(prompt["message"])
            if self.answers:
                self.pending.append({
                    "kind": "answer", "promptId": prompt["id"],
                    "text": self.answers.pop(0),
                })
