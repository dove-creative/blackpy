"""새 프로젝트 실행기의 단위 테스트 입력입니다."""

import asyncio
import base64
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "distribution"))

from _blackpy_runtime import ProjectRuntime


def make_runtime(actor_source="", background_source="", other_source=None, **kwargs):
    sources = {"배경.py": background_source, "고양이.py": actor_source}
    actors = [{"name": "고양이", "file": "고양이.py", "kind": "cat"}]
    if other_source is not None:
        sources["자동차.py"] = other_source
        actors.append({"name": "자동차", "file": "자동차.py", "kind": "car", "x": 200})
    return ProjectRuntime({
        "project": {"background": {"file": "배경.py", "kind": "plain"}, "actors": actors},
        "sources": [{
            "filename": str(ROOT / "artifacts" / "test-source" / filename),
            "source": base64.b64encode(source.encode("utf-8")).decode("ascii"),
        } for filename, source in sources.items()],
    }, **kwargs)


async def settle():
    for _ in range(8):
        await asyncio.sleep(0)


async def tick(runtime, seconds=1 / 60, events=()):
    await runtime.advance(seconds, events)
    await settle()
