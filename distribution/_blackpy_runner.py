"""실행부가 고정한 프로젝트를 별도 Python 프로세스에서 실행합니다."""

import asyncio
import json
import os
from pathlib import Path
import sys
import traceback

# runpy.run_path does not add the support directory to the module search path.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _blackpy_runtime import HttpTransport, ProjectRuntime


def main():
    snapshot = json.loads(sys.stdin.buffer.readline().decode("utf-8"))
    if snapshot["sources"]:
        directory = str(Path(snapshot["sources"][0]["filename"]).resolve().parent)
        sys.path.insert(0, directory)
    runtime = ProjectRuntime(snapshot)
    transport = HttpTransport()
    try:
        asyncio.run(runtime.run(transport))
    finally:
        transport.close()
    return 0


if __name__ == "__main__":
    try:
        result = main()
    except BaseException:
        traceback.print_exc()
        result = 1

    # Terminate all execution-owned threads, including student-created ones.
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    finally:
        os._exit(result)
