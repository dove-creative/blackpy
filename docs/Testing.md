# BlackPy 테스트 계획

이 문서는 캐릭터별 스크립트 구조의 검증 범위와 재현 명령을 설명한다. 실제 통과 여부와 실행 환경은 별도의 검증 기록에 둔다.

## 목차

- 준비
- 검증 범위
- 실행 명령
- 공개 워크플로 검증
- 화면 검증
- 결과 기록과 환경 한계

## 준비

Windows x64, .NET 10 SDK, Python 3.10 이상, Node.js 22 이상, PowerShell 7을 준비한다. 테스트는 저장소 루트에서 실행한다. 통합·배포 테스트는 실제 배포본을 임시 복사하여 사용하며 학생의 실제 파일을 수정하지 않는다.

```powershell
$env:NUGET_PACKAGES = Join-Path (Get-Location) '.cache/nuget'
./scripts/Verify-Dependencies.ps1
```

기본 배포 입력은 artifacts/blackpy이다. 다른 배포본은 BLACKPY_DISTRIBUTION 환경 변수로 지정한다. 해당 경로는 실습 폴더를 담은 배포 루트이다. 이전 main.py만 있는 배포 폴더는 새 실행부와 호환되지 않으므로 새 목적지에 배포한다.

## 검증 범위

| 검증 | 확인할 동작 |
| --- | --- |
| 의존성 | 로컬 패키지 해시·직접 참조 버전과 선택적인 소스 서브모듈 커밋이다. |
| C# | 설정·전체 코드 고정, 파일 경계·이름·초기 상태 검증, 장면 복사·말풍선·입력·실행 수명이다. |
| Python | 자기 객체 연결, 상태 대입·증감, 원래 오류 위치, 협력 반복, 일반·유지 이벤트와 종료이다. |
| 시간·동시 실행 | 일반 동작의 완료 순서, 유지 호출의 중첩, 30·60·120FPS의 이동량 일치, 속도 배율과 동시 변화량 합산이다. |
| 입력·접촉 | 키별 재진입, 시작·유지·종료, 최초 클릭 대상 고정, 배경 빈 곳 판정, 접촉 집합 변화와 숨김이다. |
| 통합 | 실제 Python·HTTP·WebSocket의 시작·중지·재시작, 전체 코드 고정, 오류·출력, 이전 실행 차단과 프로세스 정리이다. |
| 브라우저 수명 | 마지막 연결 해제 후 3초 종료, 새로고침 재연결, 여러 탭, 최초 연결 60초 제한과 Python 자식 정리이다. |
| 웹 | 입력 초점·해제·좌표 변환, 복사 코드, 대상별 명령 목록, 상태 표시와 말풍선 렌더링이다. |
| 샘플 | 실제 예제 파일을 임시 복사한 뒤 순차 이동, 방향키, 클릭, 방송, 접촉의 예상 결과를 확인한다. |
| GUI 진입점·배포 | GUI subsystem, 한글·공백 경로 및 다른 작업 폴더에서의 실행, 동봉 런타임, 새 프로젝트 구성, 재배포 시 학생 파일 보존과 구형 목적지 거절이다. |
| 설치형 명령 | 빈 폴더에 프로젝트 생성, 기존 학생 파일·편집기 설정·사용자 정의 stub 보존, 잘못된 경로·실행부 누락 안내이다. |
| wheel | Windows 배포 태그와 메타데이터, 새 가상환경에서 설치·명령 실행, 현재 Python 전달, 브라우저 종료 후 명령 종료, 재설치·제거 뒤 학생 파일 보존이다. |
| 편집기 안내 | 기본 프로젝트와 샘플의 BlackPy 명령 인식, 일반 내장 함수 유지, 오타·잘못된 인자 타입 진단 유지이다. |
| 공개 워크플로 | 소스 버전과 입력 버전 일치, 전체 검증 후 동일 wheel 전달, 검증 전용 실행의 업로드 생략, 공개 브랜치·환경 제한과 OIDC 인증이다. |

배경·캐릭터 파일을 각각 저장한 뒤 현재 실행본이 유지되고 다음 실행에 함께 반영되는지 확인한다. 시작 이벤트만 있는 프로젝트의 완료와 입력 이벤트가 있는 프로젝트의 대기 상태를 구분한다.

## 실행 명령

다음 순서로 실행한다. .NET 테스트, Publish, wheel 빌드는 앱의 obj를 공유하므로 동시에 실행하지 않는다. 일반 테스트 뒤에는 Publish로 win-x64 배포용 복원을 다시 준비한다.

```powershell
dotnet test tests/BlackThunder.BlackPy.Tests.csproj -c Release
python -m unittest discover -s tests -p 'test_*.py'
./scripts/Publish.ps1
node --test tests/Integration.test.mjs tests/EventIntegration.test.mjs tests/BrowserLifetime.test.mjs
node --test tests/Samples.test.mjs tests/Launchers.test.mjs
node --test tests/Web*.test.mjs
node tests/Deployment.test.mjs
./scripts/Build-Wheel.ps1
npm.cmd install --prefix .cache/editor-tools --no-package-lock --ignore-scripts pyright
node --test tests/Packaging.test.mjs tests/Editor.test.mjs
```

wheel 테스트의 기본 입력은 `artifacts/wheels/blackpy-0.1.0-py3-none-win_amd64.whl`이며 다른 wheel은 `BLACKPY_WHEEL` 환경 변수로 지정한다. 테스트는 임시 가상환경에 로컬 wheel을 설치하므로 PyPI 계정이 필요하지 않다. 편집기 검사는 `.cache/editor-tools`의 Pyright를 사용한다. 이 도구는 개발 검증용이며 학생의 실행 의존성이 아니다.

다른 목적지에 만든 배포본은 다음과 같이 검증한다.

```powershell
./scripts/Publish.ps1 -Destination 'C:/Classroom/blackpy-new'
$env:BLACKPY_DISTRIBUTION = 'C:/Classroom/blackpy-new'
node --test tests/Integration.test.mjs tests/EventIntegration.test.mjs tests/BrowserLifetime.test.mjs
node --test tests/Samples.test.mjs tests/Launchers.test.mjs
node tests/Deployment.test.mjs
```

15개 놀이 전용 ActivityDeployment 테스트는 폐기된 형식에 대한 검사이므로 새 전체 테스트에 포함하지 않는다.

## 공개 워크플로 검증

`.github/workflows/publish.yml`의 `Publish BlackPy`는 Windows에서 위의 전체 검증과 wheel 빌드를 순서대로 실행한다. CI 환경은 .NET 10, Python 3.13, Node.js 24이다. 비공개 UniEngine 소스 서브모듈이나 PyPI API 토큰 없이 저장소의 NuGet 패키지로 빌드할 수 있어야 한다.

먼저 `main`에서 `expected_version`을 소스 버전과 같게 지정하고 `publish=false`로 수동 실행한다. 모든 검증 작업의 통과, wheel 산출물 생성과 공개 작업의 생략을 확인한다. `main`의 코드·빌드 관련 변경에 따른 push 실행도 공개 작업을 생략해야 한다. 수동 입력 버전이 다르거나 공개 실행의 브랜치가 `main`·기본 브랜치 조건을 충족하지 않으면 업로드에 도달하지 않아야 한다.

실제 공개는 [Development](Development.md)의 publisher 설정과 요청 범위를 확인한 뒤 `publish=true`로 수행한다. 공개 작업만 `pypi` 환경과 `id-token: write` 권한을 사용하고, Windows에서 검증한 동일 wheel을 Ubuntu에서 재빌드 없이 업로드하는지 확인한다. 공개 후에는 새 Windows Python 환경에서 PyPI로부터 설치하여 버전, 프로젝트 생성·실행, 브라우저 종료에 따른 프로세스 정리를 확인한다. 공개 파일의 SHA-256은 해당 Actions 실행의 wheel과 비교한다.

검증 전용 실행의 통과는 PyPI OIDC 인증이나 공개 설치의 성공을 증명하지 않는다. 워크플로 실행 URL·소스 커밋·입력 버전·산출물 해시와 실제 수행한 공개·설치 검증을 결과 기록에 남긴다. PyPI 계정이나 GitHub 환경의 설정만 완료한 상태도 업로드 완료와 구분한다.

## 화면 검증

자동화 테스트와 별도로 실제 브라우저에서 무대·로그·명령 목록의 배치와 작은 화면의 넘침을 확인한다. 배경·캐릭터 선택, 이벤트 카드의 코드 행별 복사, 복사 성공·실패 안내, 키 유지 이동, 빈 곳·캐릭터 클릭, 말풍선과 재시작을 확인한다.

프레임마다 호출하는 유지 이벤트는 짧은 함수뿐 아니라 기다리기가 남은 상태도 검증한다. 상태 해제 후 추가 호출은 멈추고 이미 시작한 호출은 완료되어야 한다. 무한 반복과 호출 상한 오류에서도 웹의 중지·재시작으로 실행을 정리할 수 있어야 한다.

## 결과 기록과 환경 한계

새 구조의 실행 결과는 [2026-11-12 캐릭터별 스크립트 전환 검증 기록](검증%20기록/2026-11-12%20캐릭터별%20스크립트%20전환.md)에 있다.

실행 예제 5개의 별도 결과는 [2026-11-12 샘플 프로젝트 검증 기록](검증%20기록/2026-11-12%20샘플%20프로젝트.md)에 있다.

GUI 진입점·브라우저 자동 종료와 전체 재검증 결과는 [2026-11-12 창 없는 실행과 자동 종료 검증 기록](검증%20기록/2026-11-12%20창%20없는%20실행과%20자동%20종료.md)에 있다.

wheel 설치·편집기 명령 인식과 이번 전체 실행 결과는 [2026-11-12 pip 설치와 편집기 지원 검증 기록](검증%20기록/2026-11-12%20pip%20설치와%20편집기%20지원.md)에 있다.

공개용 설명을 포함한 최종 wheel의 전체 재검증은 [2026-11-12 PyPI 공개 준비 검증 기록](검증%20기록/2026-11-12%20PyPI%20공개%20준비.md)에 있다.

Trusted Publishing 설정과 GitHub Actions의 확인 상태는 [2026-11-12 Trusted Publishing 검증 기록](검증%20기록/2026-11-12%20Trusted%20Publishing.md)에 있다.

실제 결과는 docs의 검증 기록에 실행 날짜·환경·명령·통과 수치·오류·미검증 범위를 적는다. 생성 보고서는 artifacts/test-results에 두며 Git에서 제외한다. 과거 단일 main.py·15개 놀이의 통과 수치는 새 구조의 검증 결과로 재사용하지 않는다.

테스트 종료 뒤 실행 호스트와 Python 자식 프로세스가 정리되었는지 확인한다. 테스트 시작 실패와 제품 동작 실패를 구분하고, 복원·네트워크·샌드박스 제한은 그대로 기록한다.

개발 컴퓨터에서 PATH와 DOTNET_ROOT를 제한한 배포 검사는 SDK가 없는 별도 컴퓨터의 실행과 구분한다. Python 버전과 브라우저도 실제 확인한 환경만 검증한 것으로 기록한다. 단위·통합 테스트 통과를 전체 화면이나 외부 수업 자료의 시각 검사 완료로 표현하지 않는다.

Pyright 검사 결과와 실제 VS Code·Pylance 화면 검증도 구분한다. 편집기용 stub은 BlackPy 명령의 이름과 호출 형태를 알리는 것이며, 런타임의 상태 변환과 이벤트 실행 의미 전체를 검사하지 않는다. 로컬 wheel 설치 통과를 PyPI 업로드·공개 설치 완료로 기록하지 않는다.
