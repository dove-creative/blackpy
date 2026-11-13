import contextlib
import importlib.util
import io
import shutil
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "blackpy_installer", ROOT / "src" / "blackpy" / "__init__.py",
    submodule_search_locations=[str(ROOT / "src" / "blackpy")],
)
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PACKAGE
SPEC.loader.exec_module(PACKAGE)
from blackpy_installer import cli


class PackageCliTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.package = self.root / "package"
        self.package.mkdir()
        templates = self.package / "_templates"
        templates.mkdir()
        shutil.copytree(ROOT / "distribution" / "project", templates, dirs_exist_ok=True)

        self.patch = patch.object(cli, "PACKAGE_ROOT", self.package)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.output = io.StringIO()
        for redirect in (contextlib.redirect_stdout(self.output),
                         contextlib.redirect_stderr(self.output)):
            redirect.__enter__()
            self.addCleanup(redirect.__exit__, None, None, None)

    def test_new_copies_templates_and_editor_support_outside_package(self):
        project = self.root / "한글 실습"
        cache = self.package / "_templates" / "__pycache__"
        cache.mkdir()
        (cache / "cached.pyc").write_bytes(b"compiled cache")
        self.assertEqual(cli.main(["new", str(project)]), 0)
        self.assertTrue((project / "_blackpy" / "project.json").is_file())
        self.assertIn("def 말하기", (project / "_blackpy" / cli.STUB_NAME).read_text(encoding="utf-8"))
        self.assertTrue(all(path.name == "_blackpy" or path.suffix == ".py" for path in project.iterdir()))
        self.assertFalse((project / "_runtime").exists())
        self.assertFalse((project / "시작.exe").exists())

    def test_new_preserves_all_existing_files(self):
        project = self.root / "existing"
        project.mkdir()
        source = project / "배경.py"
        source.write_bytes(b"student code")
        self.assertEqual(cli.main(["new", str(project)]), 1)
        self.assertEqual(source.read_bytes(), b"student code")
        self.assertEqual(list(project.iterdir()), [source])

    def test_new_accepts_existing_empty_directory(self):
        project = self.root / "empty"
        project.mkdir()
        self.assertEqual(cli.main(["new", str(project)]), 0)

    def test_editor_preserves_student_code_and_settings(self):
        project = self.root / "existing"
        project.mkdir()
        (project / "project.json").write_bytes(b"{}")
        source = project / "배경.py"
        source.write_bytes(b"student code")
        settings = project / ".vscode" / "settings.json"
        settings.parent.mkdir()
        settings.write_bytes(b'{ // custom JSONC\n "files.autoSave": "afterDelay",\n}')
        before = settings.read_bytes()
        self.assertEqual(cli.main(["editor", str(project)]), 0)
        self.assertEqual(cli.main(["editor", str(project)]), 0)
        self.assertEqual(source.read_bytes(), b"student code")
        self.assertEqual(settings.read_bytes(), before)

    def test_editor_preserves_custom_builtins(self):
        (self.root / "project.json").write_text("{}")
        stub = self.root / cli.STUB_NAME
        stub.write_bytes(b"custom: str\n")
        self.assertEqual(cli.main(["editor", str(self.root)]), 1)
        self.assertEqual(stub.read_bytes(), b"custom: str\n")

    def test_editor_requires_a_project(self):
        self.assertEqual(cli.main(["editor", str(self.root)]), 1)
        self.assertFalse((self.root / cli.STUB_NAME).exists())

    def test_missing_runtime_is_reported_without_starting_a_process(self):
        (self.root / "project.json").write_text("{}")
        with patch.object(cli.subprocess, "Popen") as launch:
            self.assertEqual(cli.main(["run", str(self.root)]), 1)
            launch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
