import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "blackpy_autostart_tests", ROOT / "src" / "_blackpy_autostart.py",
)
autostart = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(autostart)


class AutostartTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = self.root / "한글 실습"
        self.project.mkdir()
        self.script = self.project / "고양이.py"
        self.script.write_text("def 시작():\n    말하기('안녕')\n", encoding="utf-8")
        self.config = self.project / "project.json"
        self.config.write_text(json.dumps({
            "background": {"file": "배경.py"}, "actors": [],
        }), encoding="utf-8")

        for replacement in (
            patch.object(autostart, "_handled", False),
            patch.object(autostart, "_installed", False),
            patch.object(autostart.sys, "platform", "win32"),
            patch.dict(os.environ, {"BLACKPY_AUTO_RUN": "1"}),
        ):
            replacement.start()
            self.addCleanup(replacement.stop)

    def test_install_is_idempotent_and_does_not_import_runtime_package(self):
        before = sys.modules.get("blackpy")
        with patch.object(autostart.sys, "addaudithook") as register:
            autostart.install()
            autostart.install()
        register.assert_called_once_with(autostart._audit)
        self.assertIs(sys.modules.get("blackpy"), before)

    def test_install_respects_platform_and_opt_out(self):
        with patch.object(autostart.sys, "addaudithook") as register:
            with patch.object(autostart.sys, "platform", "linux"):
                autostart.install()
            with patch.dict(os.environ, {"BLACKPY_AUTO_RUN": "0"}):
                autostart.install()
        register.assert_not_called()

    def test_any_direct_python_file_launches_the_whole_project_once(self):
        # This file is deliberately unregistered and invalid Python.
        self.script.write_text("def broken(:\n", encoding="utf-8")
        with patch.object(autostart, "_run_project", return_value=7) as run:
            with patch.object(sys, "argv", [str(self.script), "--no-browser", "--port", "0"]):
                with self.assertRaises(SystemExit) as result:
                    autostart._audit("cpython.run_file", (str(self.script),))
                autostart._audit("cpython.run_file", (str(self.script),))
        self.assertEqual(result.exception.code, 7)
        run.assert_called_once_with(str(self.project), ["--no-browser", "--port", "0"])
        self.assertEqual(self.script.read_text(encoding="utf-8"), "def broken(:\n")

    def test_module_command_and_stdin_events_do_not_launch(self):
        with patch.object(autostart, "_run_project") as run:
            events = ("cpython.run_module", "cpython.run_command", "cpython.run_stdin", "exec")
            for event in events:
                autostart._audit(event, (str(self.script),))
        run.assert_not_called()
        self.assertFalse(autostart._handled)

    def test_nonproject_file_consumes_only_the_original_direct_launch(self):
        ordinary = self.root / "ordinary.py"
        ordinary.write_text("print('ordinary')\n", encoding="utf-8")
        with patch.object(autostart, "_run_project") as run:
            autostart._audit("cpython.run_file", (str(ordinary),))
            autostart._audit("cpython.run_file", (str(self.script),))
        run.assert_not_called()

    def test_runtime_subfolders_and_non_python_files_are_untouched(self):
        runtime = self.project / "_runtime"
        runtime.mkdir()
        for filename in ("_runtime/_blackpy_runner.py", "시작.pyw", "__builtins__.pyi"):
            target = self.project / filename
            target.write_text("", encoding="utf-8")
            with self.subTest(filename=filename):
                self.assertIsNone(autostart._project_directory(str(target)))
        self.assertIsNone(autostart._project_directory(str(self.project / "missing.py")))

    def test_unrelated_or_malformed_configuration_is_not_a_blackpy_project(self):
        configurations = [
            "{", "[]", "null", "{}",
            '{"background": null, "actors": []}',
            '{"background": {"file": 1}, "actors": []}',
            '{"background": {"file": "배경.py"}, "actors": {}}',
        ]
        for configuration in configurations:
            self.config.write_text(configuration, encoding="utf-8")
            with self.subTest(configuration=configuration):
                self.assertIsNone(autostart._project_directory(str(self.script)))

    def test_opt_out_is_checked_again_before_launch(self):
        with patch.dict(os.environ, {"BLACKPY_AUTO_RUN": "0"}):
            with patch.object(autostart, "_run_project") as run:
                autostart._audit("cpython.run_file", (str(self.script),))
        run.assert_not_called()

    def test_student_search_paths_are_excluded_only_during_launch(self):
        shadow = self.root / "pythonpath"
        shadow.mkdir()
        initial = [str(self.project), str(shadow), "", *sys.path]

        def launch(directory, arguments):
            self.assertNotIn(str(self.project), sys.path)
            self.assertNotIn(str(shadow), sys.path)
            self.assertNotIn("", sys.path)
            raise ValueError("simulated launcher failure")

        with patch.object(sys, "path", initial.copy()):
            with patch.dict(os.environ, {"PYTHONPATH": str(shadow)}):
                with patch.object(autostart, "_run_project", side_effect=launch):
                    with self.assertRaisesRegex(ValueError, "simulated launcher failure"):
                        autostart._audit("cpython.run_file", (str(self.script),))
            self.assertEqual(sys.path, initial)

    def test_cli_comes_from_installed_sibling_even_with_blackpy_shadowing(self):
        installed = self.root / "site-packages"
        package = installed / "blackpy"
        package.mkdir(parents=True)
        (package / "__init__.py").write_text('answer = 23\n', encoding="utf-8")
        (package / "cli.py").write_text(
            "from . import answer\n"
            "def main(arguments):\n"
            "    assert arguments[0] == 'run'\n"
            "    assert arguments[2:] == ['--no-browser']\n"
            "    return answer\n",
            encoding="utf-8",
        )
        (self.project / "blackpy.py").write_text(
            "raise AssertionError('student code must not execute')\n", encoding="utf-8",
        )
        shadow = types.ModuleType("blackpy")
        with patch.object(autostart, "__file__", str(installed / "_blackpy_autostart.py")):
            with patch.object(sys, "path", [str(self.project), *sys.path]):
                with patch.dict(sys.modules, {"blackpy": shadow}):
                    try:
                        result = autostart._run_project(str(self.project), ["--no-browser"])
                        self.assertEqual(result, 23)
                        self.assertIs(sys.modules["blackpy"], shadow)
                    finally:
                        sys.modules.pop("_blackpy_autostart_package.cli", None)
                        sys.modules.pop("_blackpy_autostart_package", None)


if __name__ == "__main__":
    unittest.main()
