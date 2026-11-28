"""디스플레이는 공유 변수만 읽고 학생 코드를 필요로 하지 않습니다."""

import unittest

from test_runtime_support import make_runtime


class DisplayTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_actors_update_one_display_without_a_board_script(self):
        source = 'def 자신_클릭():\n    global 점수\n    점수 += 1\n'
        runtime = make_runtime(source, background_source='점수 = 0\n', other_source=source)
        runtime.project["displays"] = [{"name": "점수판", "variable": "점수", "x": 10, "y": 200}]
        self.addAsyncCleanup(runtime.close)
        self.assertEqual(runtime.snapshot()["displays"][0]["text"], "—")
        await runtime.initialize()
        self.assertEqual(runtime.snapshot()["displays"][0]["text"], "0")
        for actor in runtime.actors:
            await actor.handlers["자신_클릭"]()
        self.assertEqual(runtime.snapshot()["displays"][0]["text"], "2")
        self.assertEqual(len(runtime.actors), 2)

    async def test_missing_local_and_removed_variables_show_dash_not_zero(self):
        runtime = make_runtime('def 시작():\n    점수 = 20\n')
        self.addAsyncCleanup(runtime.close)
        runtime.project["displays"] = [{"name": "점수판", "variable": "점수"}]
        await runtime.initialize()
        await runtime.actors[0].handlers["시작"]()
        self.assertEqual(runtime.snapshot()["displays"][0]["text"], "—")
        runtime.shared_variables["점수"] = 0
        self.assertEqual(runtime.snapshot()["displays"][0]["text"], "0")
        del runtime.shared_variables["점수"]
        self.assertEqual(runtime.snapshot()["displays"][0]["text"], "—")

    async def test_values_are_literal_bounded_and_use_python_identifier_normalization(self):
        runtime = make_runtime()
        self.addAsyncCleanup(runtime.close)
        display = {"name": "표시", "variable": "값"}
        for value, expected in [(None, "None"), (False, "False"), ("<b>문자</b>", "<b>문자</b>"),
                                ("가" * 201, "가" * 199 + "…")]:
            runtime.shared_variables["값"] = value
            self.assertEqual(runtime.display_snapshot(display)["text"], expected)
        runtime.shared_variables["score"] = 3
        self.assertEqual(runtime.display_snapshot({"name": "표시", "variable": "ｓｃｏｒｅ"})["text"], "3")

        class BrokenText:
            def __str__(self):
                raise ValueError("cannot format")

        runtime.shared_variables["값"] = BrokenText()
        self.assertEqual(runtime.display_snapshot(display)["text"], "표시할 수 없음")
