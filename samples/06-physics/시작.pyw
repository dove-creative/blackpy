"""설치된 BlackPy로 이 폴더의 예제를 실행합니다."""

import ctypes
from pathlib import Path
import subprocess
import sys

MISSING_PACKAGE = 86
BOOTSTRAP = """import sys
sys.path = [entry for entry in sys.path if entry]
from importlib.metadata import PackageNotFoundError, distribution
try:
    distribution("blackpy")
except PackageNotFoundError:
    raise SystemExit(86)
from blackpy.cli import main
raise SystemExit(main(["run", *sys.argv[1:]]))
"""


def python_executable():
    executable = Path(sys.executable)
    if executable.name.lower() == "pythonw.exe":
        executable = executable.with_name("python.exe")

    return str(executable)


def show_error(message, console):
    if console and sys.stderr is not None:
        print(message, file=sys.stderr)
    elif sys.platform == "win32":
        dialog = ctypes.WinDLL("user32", use_last_error=True).MessageBoxW
        dialog.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p,
                           ctypes.c_wchar_p, ctypes.c_uint]
        dialog.restype = ctypes.c_int
        dialog(None, message, "BlackPy 실행 안내", 0x10)
    else:
        print(message, file=sys.stderr)


def main(argv=None):
    arguments = list(sys.argv[1:] if argv is None else argv)
    console = "--console" in arguments
    if console:
        arguments.remove("--console")

    if sys.platform != "win32":
        show_error("BlackPy는 Windows x64에서 실행할 수 있어요.", console)
        return 1

    python = python_executable()
    project = str(Path(__file__).resolve().parent)
    # Ignore PYTHONPATH and the working directory, but retain installed user packages.
    command = [python, "-E", "-X", "utf8", "-c", BOOTSTRAP,
               project, *arguments]
    capture = not console or sys.stdout is None or sys.stderr is None
    try:
        with subprocess.Popen(
            command, cwd=project, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE if capture else sys.stdout,
            stderr=subprocess.PIPE if capture else sys.stderr,
            encoding="utf-8", errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW,
        ) as child:
            try:
                output, error = child.communicate()
            except KeyboardInterrupt:
                subprocess.run(
                    ["taskkill.exe", "/PID", str(child.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW, check=False,
                )
                child.wait()
                return 130
    except OSError as error:
        show_error(f"Python을 실행하지 못했어요.\n{error}", console)
        return 1

    if child.returncode == MISSING_PACKAGE:
        show_error(
            "BlackPy가 설치되어 있지 않아요.\n\n"
            "터미널에서 다음 명령을 실행해 주세요:\n"
            "python -m pip install blackpy\n\n"
            f"현재 실행 Python: {python}\n"
            "같은 Python 환경에 설치한 뒤 다시 열어 주세요.",
            console,
        )
        return 1

    if child.returncode != 0 and capture:
        detail = (error or output or "").strip()
        show_error(detail or "BlackPy를 실행하지 못했어요.", console)

    return child.returncode


if __name__ == "__main__":
    raise SystemExit(main())
