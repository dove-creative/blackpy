"""무대 전역변수와 Python 지역 범위의 경계를 검증합니다."""

import traceback
import unittest

from test_runtime_support import make_runtime


class SharedVariableTests(unittest.IsolatedAsyncioTestCase):
    async def prepare(self, *args, **kwargs):
        runtime = make_runtime(*args, **kwargs)
        self.addAsyncCleanup(runtime.close)
        await runtime.initialize()
        return runtime

    async def test_coin_updates_scoreboard_and_background_immediately(self):
        runtime = await self.prepare(
            'def 자신_클릭():\n    global 점수\n    점수 = 점수 + 1\n',
            background_source='점수 = 0\ndef 시작():\n    말하기(점수, 시간=None)\n',
            other_source='def 자신_클릭():\n    말하기(점수, 시간=None)\n',
        )
        coin, board = runtime.actors
        for _ in range(3):
            await coin.handlers["자신_클릭"]()
        await board.handlers["자신_클릭"]()
        await runtime.background.handlers["시작"]()
        self.assertEqual(board.speech, "3")
        self.assertEqual(runtime.message, "3")
        self.assertEqual(runtime.shared_variables["점수"], 3)

    async def test_locals_parameters_closures_and_nonlocal_do_not_change_score(self):
        runtime = await self.prepare(
            '결과 = []\n'
            'def 계산(점수):\n'
            '    def 안쪽():\n        nonlocal 점수\n        점수 += 1\n'
            '    안쪽()\n    return 점수\n'
            'def 시작():\n'
            '    점수 = 10\n    결과.append(계산(점수))\n'
            '    결과.append((lambda 점수: 점수 + 2)(점수))\n'
            '    결과.append([점수 for 점수 in range(3)])\n',
            background_source='점수 = 0\n',
        )
        await runtime.actors[0].handlers["시작"]()
        self.assertEqual(runtime.shared_variables["점수"], 0)
        self.assertEqual(runtime.shared_variables["결과"], [11, 12, [0, 1, 2]])

    async def test_missing_global_keeps_unbound_local_error(self):
        runtime = await self.prepare(
            'def 시작():\n    점수 += 1\n', background_source='점수 = 0\n',
        )
        with self.assertRaises(UnboundLocalError):
            await runtime.actors[0].handlers["시작"]()
        self.assertEqual(runtime.shared_variables["점수"], 0)

    async def test_functions_imports_and_actor_commands_stay_local(self):
        runtime = await self.prepare(
            'import math\ndef 값():\n    return math.floor(2.5)\n'
            'def 시작():\n    말하기(값(), 시간=None)\n    위치 = (10, 20)\n',
            other_source='def 값():\n    return 9\n'
            'def 시작():\n    말하기(값(), 시간=None)\n    위치 = (30, 40)\n',
        )
        for actor in runtime.actors:
            await actor.handlers["시작"]()
        self.assertEqual([actor.speech for actor in runtime.actors], ["2", "9"])
        self.assertEqual([actor.position for actor in runtime.actors], [(10, 20), (30, 40)])
        self.assertNotIn("math", runtime.actors[1].namespace)
        self.assertNotIn("값", runtime.shared_variables)

    async def test_assignments_unpacking_mutation_and_late_global_creation(self):
        runtime = await self.prepare(
            '가, 나 = 2, 3\n목록 = [가, 나]\n합: int = 가 + 나\n'
            'def 시작():\n    global 합, 새값\n'
            '    합 += 1\n    새값 = 합\n    목록.append(새값)\n',
            other_source='def 시작():\n    말하기(합, 새값, 목록, 시간=None)\n',
        )
        for actor in runtime.actors:
            await actor.handlers["시작"]()
        self.assertEqual(runtime.actors[1].speech, "6 6 [2, 3, 6]")

    async def test_comprehension_targets_and_lambda_assignments_stay_local(self):
        runtime = await self.prepare(
            '점수 = 8\n목록 = [점수 for 점수 in range(3)]\n'
            '함수 = lambda: (점수 := 20)\n'
            'def 시작():\n    global 점수\n'
            '    점수 = (점수 := 점수 + 1)\n'
            '    목록.extend(점수 for 점수 in range(2))\n'
            '    말하기(함수(), 점수, 시간=None)\n',
        )
        await runtime.actors[0].handlers["시작"]()
        self.assertEqual(runtime.actors[0].speech, "20 9")
        self.assertEqual(runtime.shared_variables["목록"], [0, 1, 2, 0, 1])
        self.assertEqual(runtime.shared_variables["점수"], 9)

    async def test_initialization_order_and_new_run_reset(self):
        arguments = dict(
            background_source='점수 = 0\n',
            actor_source='점수 += 1\ndef 시작():\n    global 점수\n    점수 += 10\n',
            other_source='점수 += 2\n',
        )
        first = await self.prepare(**arguments)
        await first.actors[0].handlers["시작"]()
        second = await self.prepare(**arguments)
        self.assertEqual(first.shared_variables["점수"], 13)
        self.assertEqual(second.shared_variables["점수"], 3)

    async def test_deleted_shared_name_reports_original_student_line(self):
        runtime = await self.prepare(
            'def 시작():\n    global 점수\n    del 점수\n    점수 += 1\n',
            background_source='점수 = 0\n',
        )
        try:
            await runtime.actors[0].handlers["시작"]()
        except NameError as error:
            frames = traceback.extract_tb(error.__traceback__)
            student = [frame for frame in frames if frame.filename.endswith("고양이.py")]
            self.assertEqual(student[-1].lineno, 4)
        else:
            self.fail("Deleted variable did not raise NameError")
        self.assertNotIn("점수", runtime.shared_variables)

    async def test_global_declaration_after_use_is_still_invalid(self):
        with self.assertRaises(SyntaxError):
            await self.prepare('def 시작():\n    점수 = 1\n    global 점수\n')
