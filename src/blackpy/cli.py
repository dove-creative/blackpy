"""Create student projects and launch the bundled Windows runtime."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

from . import __version__

PACKAGE_ROOT = Path(__file__).resolve().parent
STUB_NAME = "__builtins__.pyi"


def new_project(destination):
    destination = Path(destination).resolve()
    if destination.exists() and (
        not destination.is_dir() or any(destination.iterdir())
    ):
        raise ValueError("새 프로젝트는 비어 있는 폴더에 만들어 주세요.")

    shutil.copytree(
        PACKAGE_ROOT / "_templates", destination, dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    print(f"프로젝트를 만들었어요: {destination}")
    print(f'실행: blackpy run "{destination}"')
    print("VS Code에서 같은 Python을 선택하면 파일만 열어도 명령 안내를 사용할 수 있어요.")


def require_project(directory):
    directory = Path(directory).resolve()
    if not ((directory / "_blackpy" / "project.json").is_file()
            or (directory / "project.json").is_file()):
        raise ValueError("project.json이 있는 프로젝트 폴더를 지정해 주세요.")

    return directory


def configure_editor(directory):
    directory = require_project(directory)
    source = (PACKAGE_ROOT / "_templates" / "_blackpy" / STUB_NAME).read_bytes()
    support = directory / "_blackpy" if (directory / "_blackpy" / "project.json").is_file() else directory
    destination = support / STUB_NAME
    if destination.exists():
        if destination.read_bytes() != source:
            raise ValueError(
                f"기존 {STUB_NAME} 파일을 보존했어요. "
                "필요한 정의를 직접 합쳐 주세요."
            )
    else:
        with destination.open("xb") as stream:
            stream.write(source)

    print(f"편집기 명령 안내를 준비했어요: {directory}")
    print("VS Code에서 Python·Pylance 확장과 BlackPy를 설치한 Python을 사용해 주세요.")


def run_project(directory, no_browser=False, port=0):
    directory = require_project(directory)
    if sys.platform != "win32":
        raise ValueError("BlackPy 실행부는 Windows x64에서 사용할 수 있어요.")

    executable = PACKAGE_ROOT / "_runtime" / "BlackThunder.BlackPy.exe"
    if not executable.is_file():
        raise ValueError("실행부가 없어요. BlackPy Windows wheel을 다시 설치해 주세요.")

    arguments = [str(executable), "--project", str(directory), "--port", str(port)]
    if no_browser:
        arguments.append("--no-browser")

    environment = os.environ.copy()
    environment["PYTHON_EXE"] = sys.executable
    environment["PYTHONUTF8"] = "1"
    child = subprocess.Popen(
        arguments, cwd=directory, env=environment,
        stdin=subprocess.DEVNULL, stdout=sys.stdout, stderr=sys.stderr,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    try:
        return child.wait()
    except KeyboardInterrupt:
        # Stop only this launcher's process tree, including student Python.
        subprocess.run(
            ["taskkill.exe", "/PID", str(child.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW, check=False,
        )
        child.wait()
        return 130


def main(argv=None):
    parser = argparse.ArgumentParser(prog="blackpy", description="BlackPy 프로젝트 도구")
    parser.add_argument("--version", action="version", version=f"BlackPy {__version__}")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("new", help="빈 폴더에 새 프로젝트 만들기")
    create.add_argument("directory")
    editor = commands.add_parser("editor", help="기존 프로젝트에 VS Code 명령 안내 추가")
    editor.add_argument("directory", nargs="?", default=".")
    run = commands.add_parser("run", help="프로젝트 실행")
    run.add_argument("directory", nargs="?", default=".")
    run.add_argument("--no-browser", action="store_true", help="브라우저 자동 열기 생략")
    run.add_argument("--port", type=int, default=0, help="서버 포트 (기본: 자동 선택)")
    arguments = parser.parse_args(argv)

    try:
        if arguments.command == "new":
            new_project(arguments.directory)
        elif arguments.command == "editor":
            configure_editor(arguments.directory)
        else:
            return run_project(arguments.directory, arguments.no_browser, arguments.port)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1

    return 0
