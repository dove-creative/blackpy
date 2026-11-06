# BlackPy 테스트 계획

이 문서는 BlackPy의 검증 범위와 재현 명령을 설명한다. 통과 여부와 실행 환경은 별도의 검증 기록에 둔다.

## 목차

- 준비
- 검증 범위
- 실행 명령
- 보고서와 결과 기록
- 환경 한계

## 준비

Windows x64에서 .NET 10 SDK, Python 3.10 이상, Node.js 22 이상, PowerShell 7을 준비한다. 모든 명령은 BlackPy 저장소 루트에서 실행한다. 통합·배포 검증은 소스 빌드가 아니라 실제 배포본을 사용한다.

```powershell
$env:NUGET_PACKAGES = Join-Path (Get-Location) '.cache/nuget'
./scripts/Verify-Dependencies.ps1
```

기본 검증 입력은 `artifacts/blackpy`이다. 다른 배포본은 `BLACKPY_DISTRIBUTION` 환경 변수로 지정한다. 이 경로도 `실습`과 다섯 놀이 폴더를 담은 상위 폴더여야 한다.

## 검증 범위

| 검증 | 확인할 동작 |
| --- | --- |
| 의존성 검사 | 로컬 패키지 SHA-256·직접 참조 버전과 선택적으로 소스 서브모듈 커밋이다. |
| C# 단위 테스트 | 이동 시간·좌표·방향·취소와 장면 상태·입력 검증이다. |
| Python 단위 테스트 | 놀이 명령의 시간·좌표·회전·경주·공동 1등·드리블·입력 경계이다. |
| 통합 테스트 | 실제 Python·HTTP·WebSocket의 시작·중지·재시작, 실행 식별자, 출력·오류, 프로세스 트리 정리이다. |
| 기본 배포 테스트 | 한글·공백 경로, 다른 작업 위치에서 BAT 실행, 동봉 런타임 사용, 저장 코드 반영과 반복 배포 시 보존이다. |
| 놀이 배포 테스트 | 다섯 BAT의 실행, 공유 실행부 경로, 저장 코드 재시작, 기본·놀이 `main.py` 보존이다. |

기본 예제와 놀이 예제는 임시 복사본에서 실행한다. 실제 학생 파일을 테스트 입력으로 사용하지 않는다.

## 실행 명령

아래 순서대로 실행한다. .NET 단위 테스트와 Publish·배포 테스트는 앱의 `obj`를 공유하므로 동시에 실행하지 않는다. 일반 테스트의 패키지 복원 후에는 Publish로 `win-x64` 배포용 복원을 다시 준비한다.

```powershell
dotnet test tests/BlackThunder.BlackPy.Tests.csproj -c Release
python -m unittest discover -s tests -p test_blackpy.py
./scripts/Publish.ps1
node --test tests/Integration.test.mjs
node tests/Deployment.test.mjs
node tests/ActivityDeployment.test.mjs
```

다른 배포본을 검증하는 예시는 다음과 같다. 앞의 단위 테스트와 Publish가 끝난 뒤 실행한다.

```powershell
$env:BLACKPY_DISTRIBUTION = 'C:/Classroom/blackpy'
node --test tests/Integration.test.mjs
node tests/Deployment.test.mjs
node tests/ActivityDeployment.test.mjs
```

검증이 끝나면 실행용 호스트·Python 자식 프로세스가 정리되었는지 확인한다. 테스트 실행 실패와 테스트가 관찰한 제품 동작 실패를 구분하고, 복원·네트워크·환경 제한을 결과에 기록한다.

## 보고서와 결과 기록

배포 검증 보고서는 `artifacts/test-results`에 생성한다. 임시 테스트 폴더의 경로와 확인 항목은 각 보고서에 남긴다. 생성 보고서는 Git에서 제외하고, 공유할 결과는 실행 날짜·환경·명령·결과·한계를 정리해 `docs/검증 기록`에 기록한다.

- [2026-11-07 초기 시제품 검증 기록](검증%20기록/2026-11-07%20초기%20시제품.md): 독립 저장소로 분리하기 전 수행한 실행·배포·자료 검사 기록이다.
- [2026-11-07 저장소 분리 검증 기록](검증%20기록/2026-11-07%20저장소%20분리.md): 독립 빌드·배포, 공유 패키지, 라이선스 고지와 수업 연결의 검증 결과이다.

기존 기록의 임시 보고서 경로는 당시 기준이다. 기록에 적힌 과거 통과 수치를 현재 변경의 검증 결과로 간주하지 않는다.

## 환경 한계

개발 컴퓨터에서 PATH와 `DOTNET_ROOT`를 제한한 배포 검증은 SDK가 없는 별도 컴퓨터에서의 실행과 구분한다. 별도 컴퓨터, Python 검색 경로, Python 버전, 브라우저를 실제로 확인한 경우에만 해당 환경의 검증 완료를 기록한다.

웹 화면 검사는 자동화 테스트 결과와 별도로 기록한다. 단위·통합 테스트 통과만으로 전체 화면이나 모든 학생 자료의 시각 검사를 완료한 것으로 표현하지 않는다.
