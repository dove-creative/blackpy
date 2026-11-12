# BlackPy 실행 예제

캐릭터별 Python 파일로 이동·입력·방송·접촉을 직접 확인하는 작은 프로젝트 모음이다.

## 실행

저장소 루트에서 현재 소스의 실행부를 한 번 준비한다. Windows x64와 Python 3.10 이상이 필요하며, 빌드에는 .NET 10 SDK와 PowerShell 7을 사용한다.

```powershell
./scripts/Publish.ps1
./samples/01-movement/시작.exe
```

각 예제 폴더의 `시작.exe`를 더블클릭해도 된다. 열린 웹에서 시작 버튼을 누른다. 키보드 예제는 무대를 클릭해 초점을 옮긴 뒤 키를 누른다. 입력을 기다리는 예제는 중지 버튼으로 끝내고, BlackPy가 열린 마지막 탭이나 창을 닫으면 약 3초 뒤 실행부도 종료된다.

실행부는 공통 `artifacts/blackpy/실습/_runtime`을 사용한다. 다른 위치로 배포했다면 예제 폴더를 지정해 직접 실행한다.

기본 목적지로 `Publish.ps1`을 실행하면 샘플별 `시작.exe`가 생성된다. 파일은 콘솔 없이 웹을 열며, `Debug.bat`은 오류 확인을 위한 콘솔 실행용이다. 새로고침으로 3초 안에 재연결하면 실행부는 유지되고 학생 코드는 중지된 상태가 된다.

```powershell
& 'C:/Classroom/blackpy/실습/시작.exe' --project './samples/01-movement'
```

설치형 BlackPy를 사용하는 경우 실행부를 다시 빌드하지 않고 설치된 명령으로 예제를 연다.

```powershell
blackpy run ./samples/01-movement
```

설치 방법은 [사용 안내](../docs/Usage.md)에 있다. 현재 PyPI 공개 전이므로 로컬 wheel을 설치하는 방식이다.

## 예제

| 폴더 | 조작과 확인할 기능 |
| --- | --- |
| [01-movement](01-movement/README.md) | 시작하면 네모로 걷기: 순차 이동·회전·반복·속도 배율이다. |
| [02-keyboard](02-keyboard/README.md) | 방향키로 움직이고 스페이스로 초기화: 키 시작·유지·종료와 초당 이동이다. |
| [03-click](03-click/README.md) | 공 누르고 놓기: 클릭 시작·유지·종료, 크기·회전·배경 클릭이다. |
| [04-broadcast](04-broadcast/README.md) | 빈 곳 클릭 또는 스페이스: 방송 수신과 여러 캐릭터의 동시 반응이다. |
| [05-contact](05-contact/README.md) | 고양이를 별로 이동: 닿는 순간·닿는 동안·떨어지는 순간이다. |

각 폴더는 `project.json`, `배경.py`, 캐릭터별 Python 파일과 편집기용 `__builtins__.pyi`를 가진 독립 프로젝트이다. VS Code에서 편집할 예제 폴더 자체를 열면 Python·Pylance 확장이 BlackPy 명령을 인식한다. Python 파일을 바꾸고 저장한 뒤 다시 시작하면 반영된다. 이 파일들은 BlackPy에서 실행하며 `python 고양이.py`처럼 직접 실행하는 스크립트가 아니다.

결과는 웹 무대와 로그에만 표시하며 별도 파일을 만들지 않는다.

## 자동 검증

배포 실행부를 준비한 뒤 저장소 루트에서 다음 명령으로 예제를 임시 복사하여 확인한다. Node.js 22 이상이 필요하다.

```powershell
node --test tests/Samples.test.mjs
```
