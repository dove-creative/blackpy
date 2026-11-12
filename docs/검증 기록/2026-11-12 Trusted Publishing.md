# Trusted Publishing 공개 검증 기록

## 변경 범위

GitHub Actions의 전체 검증과 PyPI Trusted Publishing을 위한 `.github/workflows/publish.yml`을 추가하였다. Windows에서 검증한 wheel을 Ubuntu 공개 작업으로 전달하며, 수동 공개 실행에만 OIDC 권한을 부여한다. 장기 PyPI API 토큰은 생성하거나 저장하지 않았다.

개발·테스트 문서와 작업 지침에 등록·검증·공개 절차를 반영하였다. PyPI 설명에서는 비공개 저장소의 개발 자료를 누구나 볼 수 있다는 문구를 제거하였다. 저장소의 비공개 설정은 유지하였다.

## 확인한 결과

2026-11-12에 다음 항목을 확인하였다.

| 확인 항목 | 결과 |
| --- | --- |
| 워크플로 정적 검사 | `.cache/actionlint/actionlint.exe -color .github/workflows/publish.yml`로 actionlint 1.7.12 검사 통과이다. |
| 버전·브랜치 제한 | PowerShell에서 실행한 로컬 제한 조건 6개가 통과하였다. 실제 GitHub Actions 실행과는 별도 검사이다. |
| GitHub 환경 | `pypi` 환경을 생성하고 사용자 지정 배포 정책을 `main`, 유형 `branch`로 설정하였다. |
| 소스 반영 | `393add4709a29b79665553d3790a6266e1bf4e81`을 `main`에 푸시하였다. |
| 원격 검증 | [GitHub Actions 실행 43221026888](https://github.com/dove-creative/blackpy/actions/runs/43221026888)이 성공하였다. 저장소 접근 권한이 필요하다. |

제한 조건 검사는 실제 워크플로의 PowerShell 구문에 GitHub 환경 변수를 지정하여 수행하였다. `main` push, 일치하는 버전의 검증 전용 수동 실행, `main`·기본 브랜치에서의 공개 요청은 허용되었다. 버전 불일치, 다른 브랜치의 공개 요청, 기본 브랜치가 `main`이 아닌 공개 요청은 거절되었다. 이 검사는 실제 공개 작업을 실행하지 않는다.

`samples/02-keyboard/배경.py`의 기존 후행 공백은 수정하지 않았다. 관련 없는 `docs/BlackPy - 스토리보드.drawio`와 2026-11-07 검증 기록 2개는 커밋에서 제외하였다.

## GitHub Actions 실행 결과

Windows 2025 이미지 `20261103.298.1`에서 .NET SDK 10.0.404, CPython 3.13.17, Node.js 24.22.2를 사용하였다. Windows 검증 작업 `131192277998`의 모든 단계가 통과하였다.

| 검증 | 결과 |
| --- | --- |
| C# | 53/53 통과이다. |
| Python | 46/46 통과이다. |
| 통합·이벤트·브라우저 수명 | 19/19 통과이다. |
| 샘플·GUI 진입점 | 10/10 통과이다. |
| 웹 | 20/20 통과이다. |
| 편집기·설치형 패키지 | 각각 6/6, 1/1 통과이다. |
| 배포 검증 | 별도 9개 확인 항목 통과이다. |
| wheel | 빌드와 Twine strict 검사 통과이다. |
| 공개 작업 | `131194564833`은 생략되었다. push 실행은 PyPI 공개를 수행하지 않는다. |

테스트 러너 집계는 155/155 통과이다. 배포 검증의 9개 확인 항목은 이 수치에 합산하지 않는다. 실행 명령은 [Testing](../Testing.md)의 전체 절차이다.

wheel을 담은 `blackpy-wheel` 산출물의 ID는 `13945893585`이다. 다운로드 ZIP의 크기는 48,807,128바이트, SHA-256은 `f370c1243829772cff9542921fda4b2cbf7fe7030976ef0d7e404556d5d06e3f`이다. 이 해시는 ZIP 자체의 해시이며 내부 wheel의 해시와 구분한다.

다운로드한 ZIP의 해시를 확인하고 `artifacts/publishing/43221026888`에 추출한 wheel은 다음과 같다.

- 파일: `blackpy-0.1.0-py3-none-win_amd64.whl`이다.
- 크기: 48,806,942바이트이다.
- SHA-256: `7080686e7eb37d085374d32e9c0734d7bb4e770e2073e232e975d0e1a1424921`이다.

이 파일은 검증 전용 실행의 산출물이며 최종 공개 파일이 아니다. 이후 수동 공개 실행에서 전체 검증과 wheel 빌드를 다시 수행하였으며, 그 산출물은 아래 최종 공개 결과에 따로 기록하였다.

## 최초 공개와 테스트 보완

사용자가 지정한 publisher의 등록과 0.1.0 공개를 승인한 뒤 PyPI의 pending publisher를 등록하였다. 등록 목록에서 PyPI 프로젝트 `blackpy`, 제공자 GitHub, 저장소 `dove-creative/blackpy`, 워크플로 `publish.yml`, 환경 `pypi`를 확인하였다. pending publisher 등록 자체로 프로젝트나 이름이 예약되는 것은 아니다.

`main`에서 `expected_version=0.1.0`, `publish=true`로 [최초 공개 실행 43222138575](https://github.com/dove-creative/blackpy/actions/runs/43222138575)를 시작하였다. 소스 커밋은 검증 전용 실행과 같은 `393add4709a29b79665553d3790a6266e1bf4e81`이다. 이 실행은 C# 53개와 Python 46개를 통과한 뒤 통합·이벤트·브라우저 수명 19개 중 17개 통과, 2개 실패로 중단되었다. 공개 작업은 생략되었으며 PyPI에 업로드하지 않았다.

실패한 검사는 CI의 시간 지연과 장면 전달 방식에 의존하는 조건이었다.

- `EventIntegration.test.mjs`의 유지 이동 검사는 450ms 대기 후 이동량을 25~75로 제한하였다. 실제 관측 위치는 약 -19.17993으로, 시작 위치 -100에서 약 80.82만큼 이동한 상태였다. 초당 100 이동에서 약 0.8082초에 해당하며, CI에서 실제 경과 시간이 고정 대기값보다 길어질 수 있는 조건을 반영하지 못하였다.
- `Integration.test.mjs`의 이동 검사는 0.5초 이동 중간의 장면을 반드시 관측하도록 요구하였다. 최종 좌표 검사는 통과하였으나 장면 큐의 오래된 항목 제거와 CI 스케줄링에 따라 중간 장면을 놓칠 수 있었다.

사용자가 테스트 한정 수정을 승인하여 `a4899dea049bc68f0f41ea1905e286bb5d9072fe`로 반영하였다. 런타임 코드는 변경하지 않았다. 유지 입력 검사는 두 축의 이동을 관측하고, 키 해제 처리에서 기록한 위치를 기준으로 해제한 축의 정지와 다른 축의 계속 이동을 확인하도록 바꾸었다. 일반 이동 검사는 WebSocket의 중간 장면 대신 두 캐릭터의 시작 로그가 첫 도착 로그보다 앞서는지 확인하며, 최종 좌표와 최소 완료 시간 조건을 유지하였다. Python에는 두 캐릭터의 0.25초·0.5초 위치와 이동 뒤 명령 실행을 고정 시간으로 확인하는 단위 테스트를 추가하였다.

수정 후 로컬 실행 결과는 다음과 같다.

| 검증 | 결과 |
| --- | --- |
| Python 전체 | `python -m unittest discover -s tests -p 'test_*.py'`에서 47/47 통과이다. |
| 수정한 실제 통합 검사 | `node --test --test-name-pattern 'held keys combine\|normal moves finish' tests/EventIntegration.test.mjs tests/Integration.test.mjs`에서 2/2 통과이다. |
| 입력 지연 조건 | 입력 확인 응답마다 800ms 지연을 추가한 임시 검사에서 유지 키 항목 1/1 통과이다. 제품 코드는 변경하지 않았다. |
| 파일 형식 | 변경 파일의 `git diff --check` 통과이다. |

수정 커밋의 `[skip ci]`는 중복 push 검증만 생략하며 수동 공개 검증을 생략하지 않는다. 같은 커밋을 대상으로 `main`, `expected_version=0.1.0`, `publish=true`로 [공개 재시도 43223496735](https://github.com/dove-creative/blackpy/actions/runs/43223496735)를 수행하였다.

## 최종 공개 결과

공개 재시도 43223496735는 성공하였다. Windows 검증 작업 `131200707594`는 전체 156/156 테스트와 별도 배포 확인 9개를 통과하였다. 실행 환경은 Windows 2025, .NET SDK 10.0.404, CPython 3.13.17, Node.js 24.22.2이다. Python 단위 테스트가 47개로 늘었으며 나머지 테스트 구성은 앞선 검증 전용 실행과 같다.

공개 작업 `131203084592`는 OIDC 인증을 사용하여 PyPI에 0.1.0 wheel을 업로드하였다. 장기 PyPI API 토큰은 사용하지 않았다. 이 실행의 `blackpy-wheel` 산출물 ID는 `13947615825`이며 다운로드 ZIP은 48,807,124바이트이다. ZIP을 내려받아 확인한 최종 wheel은 다음과 같다.

- 파일: `blackpy-0.1.0-py3-none-win_amd64.whl`이다.
- 크기: 48,806,938바이트이다.
- SHA-256: `e18301bd3770a93b7b42f60ac4dbf2e4ea2685eacd0cbf033f4c754a8d826d5b`이다.

최초 검증 전용 실행의 wheel과 최종 공개 wheel은 별도 산출물이다. 과거 로컬 wheel이나 검증 전용 실행의 해시를 최종 공개 파일의 해시로 재사용하지 않았다.

## 공개 설치 검증

[PyPI의 BlackPy 0.1.0 페이지](https://pypi.org/project/blackpy/0.1.0/)와 공개 파일을 확인하였다. 업로드 시각은 UTC `2026-11-12T13:07:24.950649Z`이다.

Windows `10.0.26300`, Python 3.13.18, Node.js 24.15.0, PowerShell 7.6.9에서 새 임시 폴더를 지정하여 공개 wheel을 내려받았다. 기존 로컬 빌드나 pip 캐시를 다운로드 원본으로 사용하지 않았다. 아래의 `<새 임시 폴더>`는 검증 스크립트가 만든 다운로드 경로이다.

```powershell
python -m pip --isolated download --index-url https://pypi.org/simple --no-deps --no-cache-dir --only-binary=:all: --dest '<새 임시 폴더>' blackpy==0.1.0
```

다운로드한 파일을 `tests/Packaging.test.mjs`의 입력으로 지정하여 새 가상환경 설치·프로젝트 생성·실행, 한글 명령·이동, 마지막 브라우저 연결 종료 후 자동 종료, 재설치·제거 후 학생 코드와 안내 파일 보존을 검증하였다. 결과는 1/1 통과이며 테스트 실행 시간은 약 55.05초이다.

PyPI JSON 메타데이터, 공개 저장소에서 내려받은 wheel, 실제 공개 Actions 산출물의 SHA-256이 모두 `e18301bd3770a93b7b42f60ac4dbf2e4ea2685eacd0cbf033f4c754a8d826d5b`로 일치하였다. 테스트 후 CIM 조회에서 남은 BlackPy 실행부와 Python runner 프로세스는 0개이다.

자동 검증 보고서는 `artifacts/test-results/pypi-install-0.1.0-20261112-130801-866.json`, 공개 페이지 화면은 `artifacts/publishing/pypi-blackpy-0.1.0.jpg`에 보관하였다. 두 경로는 생성 산출물이므로 Git에서 제외한다.

## 미검증 범위

PyPI 공개와 공개 파일의 설치·실행 검증은 완료하였다. Python 3.10의 실제 실행과 SDK가 없는 별도 PC의 실행은 확인하지 않았다. 학생 HTML·교사용 교안과 관련 없는 문서·학생 파일은 변경하지 않았다.
