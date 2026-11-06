# BlackPy 개발 안내

이 문서는 BlackPy의 소스 구성과 서브모듈·NuGet 의존성을 관리하는 방법을 설명한다.

## 목차

- 개발 환경
- 저장소 구성
- 서브모듈
- NuGet 의존성
- 문서와 변경 검증

## 개발 환경

Windows x64, .NET 10 SDK, PowerShell 7, Python 3.10 이상을 사용한다. 전체 검증에는 Node.js 22 이상이 필요하다. C# 언어 버전은 9이며 nullable 참조 형식은 사용하고 암시적 using은 사용하지 않는다.

빌드는 저장소에 포함된 로컬 NuGet 패키지를 사용한다. 라이브러리 소스 서브모듈을 초기화하지 않아도 빌드할 수 있다.

```powershell
$env:NUGET_PACKAGES = Join-Path (Get-Location) '.cache/nuget'
./scripts/Verify-Dependencies.ps1
dotnet build src/BlackThunder.BlackPy/BlackThunder.BlackPy.csproj -c Release
```

## 저장소 구성

| 경로 | 역할 |
| --- | --- |
| `src` | C# 실행부와 웹 무대이다. |
| `distribution` | Python 지원 모듈, 기본 시작 코드, BAT 원본이다. |
| `examples` | 다섯 놀이의 배포용 시작 코드 원본이다. |
| `scripts` | 배포와 패키지 준비 도구이다. |
| `tests` | 이동·장면·Python·통합·배포 검증이다. |
| `packages` | 고정한 로컬 NuGet 패키지와 라이선스·출처 기록이다. |
| `references` | 의존 라이브러리 소스를 고정한 서브모듈이다. |
| `guidelines` | 공통 작업 기준을 고정한 서브모듈이다. |
| `docs` | 개요·구현·사용·개발·검증 문서이다. |
| `artifacts` | 생성된 배포본과 검증 보고서이다. Git에서 제외한다. |

## 서브모듈

| 경로 | 원본 | 역할 |
| --- | --- | --- |
| `references/uniengine` | [UniEngine](https://github.com/dove-creative/uniengine) | 기본 이동 기능과 관련 소스 참조이다. 원본 접근 권한이 필요하다. |
| `references/blackbox-system` | [BlackboxSystem](https://github.com/dove-creative/blackbox-system) | 공통 진단 라이브러리의 소스 참조이다. |
| `guidelines/blackthunder-conventions` | [BlackThunder Conventions](https://github.com/dove-creative/blackthunder-conventions) | 코드·문서·작업 기준이다. |

공개 서브모듈은 다음 명령으로 초기화한다.

```powershell
git submodule update --init -- guidelines/blackthunder-conventions references/blackbox-system
```

UniEngine 소스 저장소는 비공개이다. 접근 권한이 있는 개발자는 해당 서브모듈을 별도로 초기화할 수 있다.

```powershell
git submodule update --init -- references/uniengine
./scripts/Verify-Dependencies.ps1 -IncludeSource
```

각 서브모듈은 BlackPy 저장소가 기록한 커밋으로 사용한다. 서브모듈 소스의 변경은 패키지 갱신 전에는 BlackPy 빌드에 반영되지 않는다. 의존 라이브러리의 수정은 해당 저장소에서 관리하고, 검증한 커밋과 패키지로 BlackPy의 참조를 갱신한다.

컨벤션을 갱신할 때는 변경 이력을 검토하고 프로젝트 기준과의 충돌 여부를 확인한다. BlackPy에 적용하는 규칙은 루트의 `AGENTS.md`와 `guidelines/blackthunder-conventions`를 따른다.

## NuGet 의존성

BlackPy는 UniEngine과 BlackboxSystem을 NuGet으로 직접 참조한다. UniEngine의 BlackboxSystem 의존성과 BlackPy의 직접 참조는 최종 앱에서 같은 패키지 버전으로 해석된다. 직접 선택한 버전은 UniEngine이 사용하는 API와 바이너리 호환성을 유지해야 한다.

현재 고정 자료는 다음과 같다.

| 패키지 | 버전 | 소스 커밋 |
| --- | --- | --- |
| `BlackThunder.UniEngine` | `0.1.0-mvp.23a68fe` | `23a68fe24f0ee02e38f3d0d341afca1fad3983e5` |
| `BlackThunder.BlackboxSystem` | `0.2.0` | `635c20e2ece4ce0c504ea03dda2c40679eac00e1` |

버전·소스·SHA-256의 기준은 [source-manifest.json](../packages/source-manifest.json)이다. `NuGet.config`는 `BlackThunder.*` 패키지를 `packages` 로컬 피드에서 복원하도록 지정한다. 라이브러리마다 외부 개발 폴더를 직접 프로젝트 참조하지 않는다.

`Verify-Dependencies.ps1`은 포함된 패키지의 SHA-256과 직접 참조 버전을 검사한다. `-IncludeSource`는 초기화된 두 소스 서브모듈의 고정 커밋도 검사한다.

최초 UniEngine 패키지를 준비하는 절차는 다음과 같다. `-SourceRepository`를 생략하면 `references/uniengine`을 사용한다.

```powershell
./scripts/Import-UniEngine.ps1 -SourceRepository ./references/uniengine
```

이 스크립트는 고정 커밋을 사용하며 기존 고정 패키지를 덮어쓰지 않는다. 패키지 갱신은 서브모듈 커밋, 생성 버전, 프로젝트 참조, 출처 기록을 함께 검토하는 작업이다. 갱신을 검증한 뒤 참조되지 않는 이전 패키지는 제거한다.

UniEngine 사용 범위는 Loco, Transform2D·수학, EventStream·Handle이다. BlackboxSystem의 별도 실행 진단 계측은 아직 추가하지 않았다.

## 문서와 변경 검증

README는 첫 실행과 상세 문서의 진입점이다. 개요와 구현 문서는 책임·동작·제약을 설명하며, 구체적인 API 사용은 Usage에 둔다. 테스트 계획과 실제 실행 결과는 분리한다.

검증 명령과 범위는 [Testing](Testing.md)에 있다. 배포 구조·의존성·공개 API를 바꾸면 전체 테스트와 실제 배포본 검증을 수행한다. 교육 기능이나 예제를 바꾸면 학생용 HTML과 교안의 대응 여부도 확인한다.
