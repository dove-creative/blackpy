"""객체 조회, 다른 파일의 함수 호출과 실행 순서를 검증합니다."""

import traceback
import unittest

from test_runtime_support import make_runtime, settle, tick
from blackpy import EXECUTION, MOVEMENT


class ObjectCallTests(unittest.IsolatedAsyncioTestCase):
    async def prepare(self, *args, **kwargs):
        runtime = make_runtime(*args, **kwargs)
        self.addAsyncCleanup(runtime.close)
        await runtime.initialize()
        return runtime

    async def test_target_state_arguments_return_values_and_call_order(self):
        runtime = await self.prepare(
            'def 계산(값, *, 배율=2):\n'
            '    위치 = (값, 30)\n    기다리기(0.2)\n'
            '    가시성_설정(False)\n    return 값 * 배율\n',
            '결과 = []\ndef 시작():\n'
            '    결과.append("시작")\n'
            '    결과.append(객체_구하기("고양이").계산(7, 배율=3))\n'
            '    결과.append("끝")\n',
        )
        runtime.start()
        await settle()
        self.assertEqual(runtime.shared_variables["결과"], ["시작"])
        self.assertEqual(runtime.actors[0].position, (7, 30))
        await tick(runtime, 0.2)
        self.assertEqual(runtime.shared_variables["결과"], ["시작", 21, "끝"])
        self.assertFalse(runtime.actors[0].visible)
        self.assertIsNone(runtime.error)

    async def test_saved_reference_survives_rename_and_hidden_state(self):
        runtime = await self.prepare('def 값():\n    return 이름\n')
        reference = runtime.object_of("고양이")
        runtime.rename(runtime.actors[0], "블록")
        runtime.actors[0].visible = False
        self.assertIs(runtime.object_of("블록"), reference)
        self.assertEqual(await reference.값(), "블록")
        with self.assertRaisesRegex(ValueError, "고양이.*객체가 없어요"):
            runtime.object_of("고양이")

    async def test_lookup_can_be_saved_before_target_initialization(self):
        runtime = await self.prepare(
            'def 값():\n    return 42\n',
            '대상 = 객체_구하기("고양이")\n'
            'def 시작():\n    global 결과\n    결과 = 대상.값()\n',
        )
        runtime.start()
        await settle()
        self.assertEqual(runtime.shared_variables["결과"], 42)

    async def test_nested_calls_use_each_file_and_can_call_background(self):
        runtime = await self.prepare(
            'def 값():\n    return 이름\n'
            'def 시작():\n    global 결과\n'
            '    결과 = 객체_구하기("자동차").값()\n',
            'def 값():\n    return 이름\n',
            'def 값():\n    return (이름, 객체_구하기("배경").값(), '
            '객체_구하기("고양이").값())\n',
        )
        runtime.start()
        for _ in range(3):
            await settle()
        self.assertEqual(runtime.shared_variables["결과"], ("자동차", "배경", "고양이"))

    async def test_held_caller_uses_ordinary_target_motion_and_restores_context(self):
        runtime = await self.prepare(
            'def 키_누름_중(키들):\n'
            '    객체_구하기("자동차").이동()\n    앞으로(0.5)\n',
            other_source='def 이동():\n    앞으로(20)\n',
        )
        await tick(runtime, 0.01, [{"kind": "keydown", "key": "a"}])
        self.assertEqual(runtime.actors[0].position, (0, 0))
        self.assertEqual(len(runtime.motions), 1)
        await tick(runtime, 0.1, [{"kind": "keyup", "key": "a"}])
        self.assertEqual(runtime.actors[1].position, (220, 0))
        self.assertEqual(runtime.actors[0].position, (0, 0))
        self.assertFalse(runtime.motions)
        self.assertIsNone(runtime.error)

    async def test_target_wait_does_not_block_other_events_or_drop_calls(self):
        runtime = await self.prepare(
            '기록 = []\ndef 받기(값):\n'
            '    기록.append(값)\n    기다리기(0.2)\n'
            'def 키_누름(키):\n    기록.append("키")\n',
            'def 시작():\n'
            '    객체_구하기("고양이").받기(1)\n'
            '    객체_구하기("고양이").받기(1)\n',
        )
        runtime.start()
        await settle()
        await tick(runtime, 0.05, [{"kind": "keydown", "key": "a"}])
        self.assertEqual(runtime.shared_variables["기록"], [1, "키"])
        await tick(runtime, 0.15)
        self.assertEqual(runtime.shared_variables["기록"], [1, "키", 1])

    async def test_missing_names_and_non_script_members_report_target(self):
        runtime = await self.prepare('from math import sqrt\n값 = 3\n')
        for name in ("없는 객체", "", None, 12):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "객체가 없어요"):
                runtime.object_of(name)
        reference = runtime.object_of("고양이")
        for name in ("깨지기", "값", "sqrt", "forward", "runtime", "말하기"):
            with self.subTest(name=name), self.assertRaisesRegex(AttributeError, "고양이.*함수가 없어요"):
                getattr(reference, name)

    async def test_target_error_keeps_source_location_and_restores_context(self):
        runtime = await self.prepare('def 깨지기():\n    return 1 / 0\n')
        movement = {"test": True}
        context = EXECUTION.set((True, 0.1))
        token = MOVEMENT.set(movement)
        try:
            try:
                await runtime.object_of("고양이").깨지기()
            except ZeroDivisionError as error:
                frames = traceback.extract_tb(error.__traceback__)
                self.assertTrue(any(frame.filename.endswith("고양이.py") and frame.lineno == 2
                                    for frame in frames))
            else:
                self.fail("The target exception must propagate")
            self.assertEqual(EXECUTION.get(), (True, 0.1))
            self.assertIs(MOVEMENT.get(), movement)
        finally:
            MOVEMENT.reset(token)
            EXECUTION.reset(context)

    async def test_broadcast_is_no_longer_a_command_or_event(self):
        runtime = await self.prepare('def 방송_받기(신호):\n    pass\n')
        self.assertNotIn("방송하기", runtime.actors[0].commands())
        self.assertNotIn("방송_받기", runtime.actors[0].handlers)
        self.assertFalse(runtime.persistent)
