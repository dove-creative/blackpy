# UniEngine main 이관 검증

## 변경

UniEngine 의존성을 MVP에서 main 커밋 `a933cbd7ff480c2b1edc7c431936336abe2a3330`으로 이관하였다. 고정 커밋을 Git 아카이브로 추출하여 `src/UniEngine.csproj`를 패키징하였다. 패키지 ID와 DLL 이름은 main의 `UniEngine`·`UniEngine.dll`을 사용한다.

소스 서브모듈, import 스크립트, 직접 패키지 참조, 로컬 피드 매핑, 출처 매니페스트와 개발 안내를 함께 갱신하였다. 새 패키지를 검증한 뒤 이전 MVP 패키지를 제거하였다. BlackPy 버전은 0.1.8이고 BlackboxSystem은 기존 0.2.0이다. 실행부의 C# 소스에는 UniEngine API 직접 호출이 없어 소비 코드 변경은 없었다.

| 항목 | 값 |
| --- | --- |
| 패키지 | `UniEngine.0.1.0-main.a933cbd.nupkg` |
| 패키지 SHA-256 | `0C716CC5FAC65F19514D3EF14DD7D01DD2CA9432F6D0CC0166F737C05A7EFEC4` |
| DLL SHA-256 | `AE1009461FF2F58F7F37580E204AB0CE5F772F7C8B8D2076BF8B85F717A10551` |
| 고정 소스 | `references/uniengine`의 main 커밋 `a933cbd7ff480c2b1edc7c431936336abe2a3330` |

패키지 내부 DLL, 일반·win-x64 빌드 출력, 기존 폴더 배포본, 새 검증용 폴더 배포본과 wheel 내부 DLL의 SHA-256이 모두 일치하였다. 배포본과 wheel에 이전 `BlackThunder.UniEngine.dll`이 없음을 확인하였다.

## 실행 결과

2026-11-16 Windows x64, .NET SDK 10.0.404, Python 3.13.18, Node.js 24.15.0, PowerShell 7.6.9에서 실행하였다. 명령은 [전체 테스트 안내](../Testing.md)의 순서로 수행하였다. Pyright는 기존 `.cache/editor-tools`의 설치본을 사용하였다.

| 검사 | 결과 |
| --- | --- |
| 패키지·소스 고정 검사 | `Verify-Dependencies.ps1 -IncludeSource` 통과 |
| C# Release | 150/150 통과 |
| Python 전체 | 122/122 통과 |
| 통합·이벤트·물리·독립 시뮬레이션·텍스트 입력·브라우저 수명 | 41/41 통과 |
| 샘플 | 6/6 통과 |
| 웹 단위 | 37/37 통과 |
| 폴더 배포 | 현재 템플릿의 새 목적지와 구형 정리 후 기본 목적지에서 각각 통과 |
| wheel 빌드·Twine 메타데이터 | 0.1.8 wheel 생성과 엄격 검사 통과 |
| wheel·편집기·샘플 진입점·직접 실행 | 31/31 통과 |
| 초기 기존 학생 파일 보존 | 첫 검증 당시 `artifacts/blackpy/실습`의 Python 파일 3개와 `project.json` 해시 유지 |

처음 샌드박스에서 실행한 C# 검사는 테스트 호스트와 90초 안에 연결하지 못하여 시작이 중단되었다. 일반 실행 환경에서 같은 검사를 다시 실행하여 150개가 통과하였다. 최초 NuGet 복원에는 취약성 정보 서버 접근 실패인 NU1900 경고가 있었으며, 패키지 복원과 컴파일은 성공하였다.

첫 폴더 배포 검사는 보존된 이전 `artifacts/blackpy/실습`을 사용하여 기본 장면·안내 문구를 기다리는 단계에서 시간 초과되었다. 이 폴더의 학생 파일에는 현재 런타임이 문법 오류로 안내하는 이전 `키_클릭` 계열 이벤트가 남아 있음을 소스로 확인하였다. 실패 로그 자체는 학생 오류 내용을 수집하지 않았다. 기존 파일을 수정하지 않고 `.cache/main-a933cbd-validation/distribution`에 현재 기본 템플릿을 새로 배포한 뒤 `BLACKPY_DISTRIBUTION`으로 지정하여 배포 검사를 통과하였다.

새 배포본에서는 한글·공백 경로와 다른 작업 폴더에서 GUI 시작, 동봉 런타임 사용, 기본 프로젝트 실행, 저장 후 다시 실행, 마지막 브라우저 연결 종료, 재배포 시 학생 파일 보존과 구형 목적지 거절을 확인하였다. wheel 검사는 새 임시 가상환경에서 현재 템플릿과 설치·제거 후의 실행 경계를 확인하였다.

로컬 로그는 `.cache/main-a933cbd-validation`에 보관한다. `02-dotnet.log`는 샌드박스 시작 실패, `02b-dotnet.log`는 C# 재실행 결과이다. `08-deployment.log`는 이전 학생 프로젝트의 실패이며 `08b-deployment.log`는 새 배포본의 통과 결과이다.

## 구형 기본 배포본 교체

후속 정리에서는 기존 `artifacts/blackpy` 폴더를 제거하고 현재 `distribution/project` 템플릿으로 기본 배포본을 다시 생성하였다. 경로가 저장소의 지정된 배포 폴더인지와 재분석 지점이 없는지를 확인한 뒤 제거하였다. Python 파일은 실습 폴더에 두고 설정·실행 도구·동봉 런타임은 `실습/_blackpy`에 배치하였다. 구형 루트 `project.json`과 이전 이벤트를 사용하는 학생 파일은 이 기본 배포본에 남지 않는다. 일반 배포 스크립트의 기존 학생 파일 보존 동작은 변경하지 않았다.

`BLACKPY_DISTRIBUTION`을 지정하지 않은 기본 배포 검사를 다시 실행하여 통과하였다. GUI 시작, 동봉 런타임과 인증된 WebSocket 장면, 배경·캐릭터 두 개의 실행, 저장 후 다시 실행, 마지막 브라우저 연결 종료와 재배포 경계를 확인하였다. 재생성·재검증 로그는 각각 `11-default-publish.log`와 `12-default-deployment.log`이다.

## 범위

프레임 성능 측정, 실제 브라우저 화면·IME·VS Code 버튼 조작, 별도 SDK 미설치 컴퓨터 실행, PyPI 공개와 사용자 환경의 설치는 수행하지 않았다.
