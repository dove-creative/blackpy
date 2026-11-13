# BlackPy 실행 예제

캐릭터별 Python 파일로 이동·입력·방송·접촉·물리를 직접 확인하는 작은 프로젝트 모음이다.

## 실행

Windows x64와 Python 3.10 이상이 필요하다. 사용할 Python 환경에 BlackPy 0.1.3을 설치하거나 갱신한 뒤 저장소 루트에서 예제를 연다. 설치는 Python 환경마다 한 번 수행하며 모든 샘플이 같은 설치를 사용한다.

새 폴더 구성은 0.1.3 실행부가 필요하다. PyPI 공개 전에는 [개발 안내](../docs/Development.md)에 따라 만든 로컬 wheel을 설치한다.

```powershell
python -m pip install --upgrade blackpy
python -m blackpy run ./samples/01-movement
```

Python의 `.pyw` 파일 연결이 설정되어 있으면 각 예제 폴더의 `_blackpy/시작.pyw`를 더블클릭해도 된다. 별도 콘솔 창 없이 웹을 열며, BlackPy가 설치되지 않았으면 설치 방법을 안내하고 종료한다. 패키지를 자동으로 설치하지 않는다.

0.1.1부터 예제 폴더의 어느 `.py` 파일이든 직접 실행하여 같은 무대를 열 수 있다. VS Code에서 해당 폴더를 열고 BlackPy를 설치한 Python을 선택한 뒤 `배경.py`나 캐릭터 파일의 'Run Python File'을 누른다. 명령줄에서는 `python ./samples/01-movement/고양이.py`를 사용한다. 설치와 직접 실행 조건은 [사용 안내](../docs/Usage.md)에 있다.

열린 웹에서 시작 버튼을 누른다. 키보드 예제는 무대를 클릭해 초점을 옮긴 뒤 키를 누른다. 입력을 기다리는 예제는 중지 버튼으로 끝내고, BlackPy가 열린 마지막 탭이나 창을 닫으면 약 3초 뒤 실행부와 샘플 실행기도 종료된다. 새로고침으로 3초 안에 재연결하면 실행부는 유지되고 학생 코드는 중지된 상태가 된다.

샘플은 설치된 BlackPy를 사용하며 저장소의 `artifacts` 실행부를 대신 사용하지 않는다. 샘플 실행을 위한 소스 빌드나 .NET SDK는 필요하지 않다. 이전에 생성한 샘플의 `시작.exe`는 현재 진입점이 아니며, `Publish.ps1`도 샘플 실행 파일을 생성하지 않는다.

여러 Python이나 가상환경을 사용할 때는 설치와 실행에 같은 Python을 사용한다. 더블클릭에 연결된 Python은 터미널의 Python과 다를 수 있다. 가상환경에서는 해당 환경을 활성화한 터미널에서 `python -m blackpy run ./samples/01-movement`를 실행한다.

`_blackpy/Debug.bat`은 터미널의 Python으로 같은 샘플 실행기를 열어 오류를 확인하는 용도이다. 명령줄에서는 다음과 같이 실행할 수 있다.

```powershell
python ./samples/01-movement/_blackpy/시작.pyw --console
```

설치 방법과 프로젝트 구성은 [사용 안내](../docs/Usage.md)에 있다.

## 예제

| 폴더 | 조작과 확인할 기능 |
| --- | --- |
| [01-movement](01-movement/_blackpy/README.md) | 시작하면 네모로 걷기: 순차 이동·회전·반복·속도 배율이다. |
| [02-keyboard](02-keyboard/_blackpy/README.md) | 방향키로 움직이고 스페이스로 초기화: 키 시작·유지·종료와 초당 이동이다. |
| [03-click](03-click/_blackpy/README.md) | 공 누르고 놓기: 클릭 시작·유지·종료, 크기·회전·배경 클릭이다. |
| [04-broadcast](04-broadcast/_blackpy/README.md) | 빈 곳 클릭 또는 스페이스: 방송 수신과 여러 캐릭터의 동시 반응이다. |
| [05-contact](05-contact/_blackpy/README.md) | 고양이를 별로 이동: 닿는 순간·닿는 동안·떨어지는 순간이다. |
| [06-physics](06-physics/_blackpy/README.md) | 공을 발판에 떨어뜨리고 방향키·스페이스로 밀기: 중력·충격·무게·정지와 경계 충돌이다. |

06-physics는 이전 로컬 0.1.1 wheel과 구분되는 0.1.3 실행부을 사용한다. 물리 엔진은 설치 패키지에 포함되어 있으며 Python 물리 패키지를 따로 설치하지 않는다.

각 폴더의 바깥에는 `배경.py`와 캐릭터별 Python 파일만 두고 설정·명령 안내·시작 도구·설명서는 `_blackpy`에 모은다. VS Code에서 BlackPy 0.1.3을 설치한 Python을 선택하면 파일만 열어도 명령을 안내한다. Python 파일을 바꾸고 저장한 뒤 웹에서 다시 시작하면 반영된다. 직접 실행은 프로젝트 전체의 무대를 열고, 실제 실행 대상은 `project.json`에 등록된 파일로 정한다.

BlackPy가 없는 Python에서 학생 `.py` 파일을 직접 실행하면 일반 Python 동작이며 무대가 열리지 않는다. 미설치 상태의 안내 창은 `시작.pyw`에서 제공한다.

결과는 웹 무대와 콘솔에만 표시하며 별도 파일을 만들지 않는다.

## 자동 검증

개발 검증에서는 배포 실행부로 예제 코드의 동작을 확인하고, 새 가상환경에 설치한 wheel로 샘플 진입점을 확인한다. 학생 파일은 임시 복사본을 사용한다. .NET 10 SDK, PowerShell 7, Node.js 22 이상이 필요하며 전체 검증 순서는 [Testing](../docs/Testing.md)에 있다.

```powershell
./scripts/Publish.ps1
node --test tests/Samples.test.mjs
./scripts/Build-Wheel.ps1
node --test tests/Launchers.test.mjs tests/DirectRun.test.mjs
```
