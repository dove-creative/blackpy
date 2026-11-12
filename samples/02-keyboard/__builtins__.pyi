"""BlackPy 전용 명령 안내입니다. 이 파일은 실행되지 않습니다."""

from typing import overload as _overload

이름: str
위치: tuple[float, float]
방향: float
속도: float
크기: float
가시성: bool
배경: str


def 말하기(내용: str, /) -> None:
    """말풍선을 표시해요. 배경에서는 무대 안내를 표시해요."""


def 앞으로(값: float, /) -> None:
    """일반 이벤트에서는 이동 거리, ~중 이벤트에서는 초당 이동량이에요."""


def 왼쪽으로돌기(값: float, /) -> None:
    """왼쪽으로 돌아요. ~중 이벤트에서는 초당 회전 각도예요."""


def 오른쪽으로돌기(값: float, /) -> None:
    """오른쪽으로 돌아요. ~중 이벤트에서는 초당 회전 각도예요."""


def 좌표로(가로: float, 세로: float, /) -> None:
    """지정한 좌표로 즉시 이동해요."""


@_overload
def 바라보기(각도: float, /) -> None: ...
@_overload
def 바라보기(가로: float, 세로: float, /) -> None: ...


def 속도_변경(변화량: float, /) -> None:
    """이동·회전 속도 배율에 변화량을 더해요. 배율은 0보다 커야 해요."""


def 크기_바꾸기(변화량: float, /) -> None:
    """현재 크기에 변화량을 더해요."""


def 크기_정하기(배율: float, /) -> None:
    """크기를 0.1~5 사이의 배율로 정해요."""


def 가시성_설정(보임: bool, /) -> None:
    """True면 보이고 False면 숨어요."""


def 기다리기(초: float, /) -> None:
    """지정한 시간 동안 이 이벤트를 기다려요. 다른 이벤트는 계속 실행돼요."""


def 방송하기(신호_이름: str, /) -> None:
    """배경과 캐릭터의 방송_받기 이벤트에 신호를 보내요."""


def 랜덤(부터: int, 까지: int, /) -> int:
    """양 끝을 포함하는 무작위 정수를 구해요."""


def 각도로(가로: float, 세로: float, /) -> float:
    """방향 벡터의 각도를 구해요. 오른쪽은 0도, 위쪽은 90도예요."""


def 위치_구하기(대상_이름: str, /) -> tuple[float, float]:
    """이름으로 찾은 캐릭터의 (가로, 세로) 위치를 구해요."""


def 방향_구하기(대상_이름: str, /) -> float:
    """이름으로 찾은 캐릭터의 방향을 구해요."""
