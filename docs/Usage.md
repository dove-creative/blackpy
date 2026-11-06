# BlackPy 사용 안내

이 문서는 배포 폴더를 준비하고 저장한 Python 코드를 실행하는 방법과 학생용 API를 설명한다.

## 목차

- 배포 폴더 준비
- 학생 코드 실행
- 배포 폴더 구성
- 캐릭터와 무대

    - 경주
    - 드리블

- 기본 고양이 이동
- 실행 설정과 문제 확인

## 배포 폴더 준비

Windows x64에서 .NET 10 SDK와 PowerShell 7을 사용한다. 저장소 루트에서 다음 명령을 실행한다.

```powershell
./scripts/Publish.ps1
```

기본 출력은 `artifacts/blackpy`이다. 다른 위치로 배포하려면 출력 폴더를 지정한다.

```powershell
./scripts/Publish.ps1 -Destination 'C:/Classroom/blackpy'
```

`-Destination`은 `실습`과 다섯 놀이 폴더를 담을 상위 폴더이다. 필요한 패키지 복원이 끝난 환경에서는 `-SkipRestore`를 사용할 수 있다.

배포는 실행부·지원 모듈·BAT를 갱신하고, 없는 `main.py`만 예제 원본에서 만든다. 기존 `main.py`는 덮어쓰지 않는다. HTML이나 교안은 생성하지 않는다.

배포본에는 BlackPy 자체 고지, 의존 라이브러리 고지, 동봉한 .NET·ASP.NET Core 런타임 고지를 함께 포함한다. 배포 폴더를 복사할 때 이 파일들도 보존한다.

## 학생 코드 실행

1. 학생 컴퓨터에 Python 3.10 이상과 편집기를 준비한다.
2. 원하는 놀이 폴더의 `시작.bat`을 실행한다.
3. 같은 폴더의 `main.py`를 VS Code에서 열어 수정하고 저장한다.
4. 열린 웹의 시작 버튼을 눌러 결과를 확인한다.
5. 실행 중 멈추려면 중지, 저장한 코드를 처음부터 실행하려면 다시 시작을 누른다.

`main.py`는 웹의 실행 제어를 통해 실행한다. 편집기의 일반 Python 실행으로 지원 모듈을 호출하면 실행부 연결 정보가 없어 안내 오류가 발생한다. 별도의 Python 패키지는 설치하지 않는다.

## 배포 폴더 구성

```text
blackpy/
├─ 실습/
│  ├─ _runtime/
│  ├─ main.py
│  ├─ playground.py
│  ├─ blackpy.py
│  └─ 시작.bat
├─ 1. 도시를 가로지르는 자동차/
│  ├─ main.py
│  ├─ blackpy.py
│  └─ 시작.bat
├─ 2. 댄스 파티/
├─ 3. 달리기 경주/
├─ 4. 농구공 드리블/
└─ 5. 으스스한 숲/
```

다섯 놀이 폴더는 같은 구성이다. 각각의 BAT가 상위 `실습/_runtime`을 사용하므로 `blackpy` 폴더 전체를 함께 전달한다. 기본 고양이 이동은 `실습/시작.bat`으로 실행한다.

학생이 바꾼 코드를 원본으로 되돌릴 때는 `examples/<단원명>/main.py` 또는 수업 자료가 제공하는 시작 코드를 사용한다.

## 캐릭터와 무대

```python
from blackpy import Actor, stage

stage.background("city")
car = Actor("car", x=-260, y=-140, name="자동차")
car.set_speed(200)
car.forward(420)
stage.say("도착!")
```

무대는 800×600이며 중앙이 `(0, 0)`, 오른쪽과 위쪽이 양수이다. 기본 방향은 오른쪽이다. 이동 거리는 무대 좌표 단위, 각도는 도 단위, 대기는 초 단위이다.

| API | 동작 |
| --- | --- |
| `Actor(kind, x=0, y=0, name="", scale=1)` | 외형·위치·이름·크기를 지정해 캐릭터를 만든다. |
| `actor.forward(distance)` | 현재 방향으로 이동한다. |
| `actor.backward(distance)` | 방향을 유지하고 뒤로 이동한다. |
| `actor.left(degrees)` | 왼쪽으로 회전한다. |
| `actor.right(degrees)` | 오른쪽으로 회전한다. |
| `actor.goto(x, y)` | 방향을 유지하고 지정 좌표로 이동한다. |
| `actor.set_speed(speed)` | 이동 속도를 초당 1~2000단위로 지정한다. |
| `stage.background(name)` | 준비된 배경으로 바꾼다. |
| `stage.say(message)` | 200자 이내의 글을 표시한다. 소리는 나지 않는다. |
| `stage.wait(seconds)` | 0~3600초 동안 기다린다. |

각 이동·회전 호출은 동작을 마친 뒤 반환한다. 기본 이동 속도는 초당 200단위, 회전 속도는 초당 180도이다. `set_speed`는 회전 속도와 드리블 시간에 영향을 주지 않는다.

배경 이름은 `plain`, `city`, `dance`, `track`, `court`, `forest`이다. 캐릭터 외형은 `car`, `cat`, `rabbit`, `ball`, `bat`이다. 한 실행에서 `Actor`는 최대 16개, `scale`은 0.1~5를 지원한다. 그림은 웹에서 직접 그리며 외부 이미지나 CDN을 요구하지 않는다.

### 경주

`stage.race(*actors, finish_x=260)`은 각 캐릭터의 현재 위치와 속도로 동시에 달린다. 캐릭터 중심이 도착선에 닿는 시간을 비교하며, 모두 도착한 뒤 1등 이름을 반환한다. 도착 시간이 같으면 공동 1등 문구를 반환한다. 출발 위치는 도착선 이하이어야 한다.

### 드리블

`stage.dribble(player, ball, bounces=4, height=100, distance=360)`은 친구와 공을 함께 옮기며 공을 위아래로 움직인다. 한 번에 0.7초가 걸리며, 높이는 0~200, 횟수는 1~50이다. 높이는 공의 초기 위치를 기준으로 한다. 실제 중력·접촉·슛 판정을 제공하는 명령은 아니다.

## 기본 고양이 이동

`실습/main.py`는 다음과 같이 `playground.cat`을 사용한다.

```python
from playground import cat

for _ in range(4):
    cat.forward(100)
    cat.right(90)

print("완료!")
```

`cat`도 `forward`, `backward`, `left`, `right`, `goto`를 제공한다. 이동 속도는 초당 200단위, 회전 속도는 초당 180도이며 음수·0 거리, 360도 회전, 무대 밖 좌표를 지원한다. `playground.cat`과 `blackpy.Actor`는 각각의 예제 흐름에서 사용한다.

## 실행 설정과 문제 확인

실행부는 `PYTHON_EXE`, PATH의 `python`, `py -3` 순서로 지원되는 Python을 찾는다. 찾지 못하면 안내하고 종료한다. `input()`은 지원하지 않으며 호출하면 EOFError가 발생한다.

Python 출력과 오류는 웹에 표시한다. 오류에 나온 학생 파일과 줄을 확인해 코드를 수정하고 저장한 뒤 다시 실행한다. 마지막 웹 연결을 닫으면 실행이 중지되며, 실행부에 다시 연결하면 현재 장면과 출력이 표시된다.

개발·검증용 실행 옵션은 다음과 같다.

| 옵션 | 의미 |
| --- | --- |
| `--project <폴더>` | 실행할 `main.py`가 있는 폴더이다. |
| `--no-browser` | 기본 브라우저를 자동으로 열지 않는다. |
| `--port <번호>` | 사용할 포트이다. `0`이면 사용 가능한 포트를 선택한다. |

실행부는 시작할 때 `PLAYGROUND_URL=` 뒤에 접속 주소를 출력한다.
