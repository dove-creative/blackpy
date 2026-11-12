# BlackPy 개발 안내

이 문서는 BlackPy의 소스 구성, 의존성 관리, wheel 빌드와 공개 절차를 설명한다.

## 목차

- 개발 환경
- 저장소 구성
- wheel 빌드와 공개
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
| `src/BlackThunder.BlackPy` | C# 실행부와 웹 무대이다. |
| `src/blackpy` | pip 설치형의 프로젝트 생성·편집기 지원·실행 명령이다. |
| `pyproject.toml` | Python 패키지 정보, 진입점과 Windows wheel 빌드 설정이다. |
| `.github/workflows/publish.yml` | `main`의 코드·빌드 변경 검증과 수동 PyPI Trusted Publishing을 실행하는 워크플로이다. |
| `distribution` | Python 지원 모듈과 BAT 원본이다. |
| `distribution/project` | 배경·캐릭터별 새 기본 프로젝트와 편집기 안내 파일의 원본이다. |
| `samples` | 이동·키 입력·클릭·방송·접촉을 직접 실행하는 독립 프로젝트이다. |
| `scripts` | 배포와 패키지 준비 도구이다. |
| `tests` | 프로젝트·장면·입력·Python·웹·통합·배포 검증이다. |
| `packages` | 고정한 로컬 NuGet 패키지와 라이선스·출처 기록이다. |
| `references` | 의존 라이브러리 소스를 고정한 서브모듈이다. |
| `guidelines` | 공통 작업 기준을 고정한 서브모듈이다. |
| `docs` | 개요·구현·사용·개발·검증 문서이다. |
| `artifacts` | 생성된 배포본과 검증 보고서이다. Git에서 제외한다. |

`Publish.ps1`은 배포본의 `실습/시작.exe`를 생성한다. 기본 목적지인 `artifacts/blackpy`로 배포할 때는 각 `samples` 프로젝트에도 `시작.exe`를 생성하며, 이 파일들은 Git에서 제외한다. 다른 목적지로 배포할 때는 기존 샘플 실행 파일의 경로를 바꾸지 않는다.

`New-Launcher.ps1`과 `Launcher.proj`는 선택된 .NET SDK의 MSBuild 태스크에서 raw apphost를 GUI 진입점으로 만들고 관리 DLL의 상대경로를 내장한다. 생성 도구는 SDK의 런타임에서 실행하므로 PowerShell을 실행하는 .NET 버전에 묶이지 않는다. 배포 폴더를 옮겨도 상대경로로 공통 런타임을 찾는다. 생성 API의 기준은 [.NET HostWriter 구현](https://github.com/dotnet/runtime/blob/main/src/installer/managed/Microsoft.NET.HostModel/AppHost/HostWriter.cs)이다. 기존 `Debug.bat`은 콘솔 진단용으로 함께 제공한다.

## wheel 빌드와 공개

### 로컬 빌드

Windows x64에서 다음 명령을 실행한다. Python 빌드 도구는 `.cache/packaging-venv`에 설치한다. 처음 준비할 때는 Python 패키지 저장소에 접근할 수 있어야 한다.

```powershell
./scripts/Build-Wheel.ps1
python -m pip install ./artifacts/wheels/blackpy-0.1.0-py3-none-win_amd64.whl
```

`Build-Wheel.ps1`은 Python 빌드 도구를 준비한 뒤 wheel을 생성하고 Twine으로 메타데이터를 검사한다. `wheel_hook.py`는 새 임시 경로에 `Publish.ps1`을 실행하고 그 결과의 공통 실행부와 `distribution/project`의 원본을 묶는다. 기존 `artifacts/blackpy/실습`이나 학생 프로젝트의 수정 내용은 wheel의 원본으로 사용하지 않는다.

wheel에는 다음 구조가 설치된다.

```text
site-packages/
└─ blackpy/
   ├─ cli.py
   ├─ __main__.py
   ├─ _templates/
   │  ├─ project.json
   │  ├─ 배경.py
   │  ├─ 고양이.py
   │  ├─ 자동차.py
   │  └─ __builtins__.pyi
   └─ _runtime/
      ├─ BlackThunder.BlackPy.exe
      ├─ blackpy.py
      ├─ _blackpy_runner.py
      ├─ wwwroot/
      └─ licenses/
```

실제 `_runtime`에는 다른 Python 지원 모듈과 동봉 .NET·ASP.NET Core의 DLL·설정도 들어간다. `blackpy` 명령 진입점은 해당 Python 환경의 Scripts 폴더에 설치된다. 설치형 명령과 실행부 내부의 `blackpy.py`는 서로 다른 Python 프로세스에서 사용한다. 실행기는 자신의 지원 모듈 경로를 우선하여 가져온다.

배포 태그는 `py3-none-win_amd64`, 최소 Python 버전은 3.10이다. 이 작업은 Windows용 wheel 배포이며 sdist·editable 설치를 배포 절차로 사용하지 않는다. 패키지 버전은 `src/blackpy/__init__.py`에서 관리한다. 빌드·설치 도구의 실행 절차는 [Python Packaging User Guide](https://packaging.python.org/en/latest/tutorials/packaging-projects/)를 기준으로 한다.

### PyPI 공개

공개 절차는 GitHub Actions의 Trusted Publishing을 사용한다. PyPI는 지정한 저장소·워크플로·환경의 OIDC 신원을 확인하여 `blackpy` 프로젝트의 업로드를 허용한다. 장기간 보관하는 PyPI API 토큰을 발급하거나 GitHub Secret에 등록할 필요가 없다. 로컬 wheel 설치, Actions 검증, PyPI 공개 설치는 각각 별도로 확인한다. [PyPI Trusted Publishing 실행 안내](https://docs.pypi.org/trusted-publishers/using-a-publisher/)

최초 공개를 준비할 때는 PyPI 계정을 만들고 이메일 확인과 2단계 인증을 완료한다. 복구 코드도 별도로 보관한다. [PyPI 2단계 인증 안내](https://docs.pypi.org/your-account/two-factor-authentication/)

GitHub 저장소에 `pypi` 환경을 만들고 배포 브랜치를 `main`으로 제한한다. PyPI 프로젝트가 아직 없으면 계정의 [Publishing 설정](https://pypi.org/manage/account/publishing/)에서 GitHub Actions용 pending publisher를 다음 값으로 등록한다.

| PyPI 설정 항목 | 값 |
| --- | --- |
| PyPI Project Name | `blackpy` |
| Owner | `dove-creative` |
| Repository name | `blackpy` |
| Workflow name | `publish.yml` |
| Environment name | `pypi` |

Workflow name에는 화면에 보이는 `Publish BlackPy`나 전체 경로가 아니라 `.github/workflows` 아래의 파일명 `publish.yml`을 입력한다. 저장소·워크플로 파일명·환경은 실제 GitHub 설정과 정확히 일치해야 한다. pending publisher 등록만으로 프로젝트가 생성되거나 이름이 예약되지는 않는다. 첫 업로드가 성공하면 프로젝트가 만들어지고 일반 publisher로 전환된다. 프로젝트가 이미 존재하면 해당 프로젝트의 Publishing 설정에서 등록한다. [PyPI 최초 프로젝트 등록 안내](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/)

공개 실행은 다음 순서이다.

1. 공개할 변경을 `main`에 반영하고 `src/blackpy/__init__.py`의 버전을 확인한다.
2. GitHub Actions의 `Publish BlackPy`에서 `main`을 선택하고 `expected_version`에 해당 버전을 입력한다. 먼저 `publish`를 끈 상태로 실행하여 전체 검증과 wheel 생성을 확인한다.
3. 같은 변경의 검증과 publisher 설정을 확인한 뒤 `main`, 같은 `expected_version`, `publish=true`로 다시 실행한다. 이 실행도 전체 검증과 빌드를 수행하며, 검증이 통과한 wheel을 PyPI에 공개한다.
4. 새 Windows Python 환경에서 `python -m pip install blackpy`로 내려받고 버전·프로젝트 생성·실행을 확인한다. 공개된 wheel의 SHA-256과 Actions 산출물도 비교한다.

워크플로는 Windows에서 .NET 10, Python 3.13, Node.js 24로 전체 검증과 wheel 빌드를 순서대로 수행한다. `main`에 코드·빌드 관련 변경을 푸시해도 검증과 wheel 생성이 실행되지만 공개는 수행하지 않는다. Ubuntu 공개 작업은 같은 실행에서 검증한 wheel 산출물을 받아 재빌드 없이 업로드한다. `id-token: write` 권한은 `pypi` 환경을 사용하는 공개 작업에만 부여한다. 수동 실행에서 `publish=false`는 업로드를 생략하며, `publish=true`는 `main`이 저장소의 기본 브랜치일 때만 허용한다. 수동 입력한 `expected_version`은 소스 버전과 일치해야 한다.

이후 공개는 패키지 버전을 올려 같은 절차로 수행한다. 이미 공개한 버전의 파일을 덮어쓰지 않는다. TestPyPI는 계정·publisher 설정·저장소가 PyPI와 별개이며, TestPyPI 업로드만으로 일반 `pip install blackpy`가 가능해지는 것은 아니다. 공개 성공 여부와 실제 설치 결과는 [검증 기록](Testing.md)에 따로 남긴다.

## 서브모듈

| 경로 | 원본 | 역할 |
| --- | --- | --- |
| `references/uniengine` | [UniEngine](https://github.com/dove-creative/uniengine) | 고정한 NuGet 패키지의 소스 참조이다. 원본 접근 권한이 필요하다. |
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

캐릭터별 스크립트 구조의 움직임·상태·이벤트는 Python 런타임에서 처리한다. 이전 고양이 전용 UniEngine 이동 경로는 제거하였다. NuGet 참조와 패키지·소스 고정 정보는 이번 개편에서 변경하지 않았으며, BlackboxSystem의 별도 실행 진단 계측은 추가하지 않았다.

## 문서와 변경 검증

기본 프로젝트는 project.json, 배경·캐릭터 파일과 편집기용 `__builtins__.pyi`로 구성한다. Publish는 artifacts/blackpy/실습에 프로젝트를, 그 아래 _runtime에 실행부와 지원 모듈을 배치한다. 기존 학생 코드·설정을 보존하고 없는 기본 파일만 추가한다. 구형 main.py만 있는 목적지는 거절하며 별도의 새 배포 경로를 사용한다. 설치형의 프로젝트 생성·실행·편집기 설정은 [Usage](Usage.md)에 있다.

이전 15개 놀이와 Actor·stage·playground 예제는 현재 실행부와 호환되지 않으므로 새 파일 구성·명령·이벤트 의미에 맞춰 재작성해야 한다. 실행부 배포가 외부 수업 자료를 자동 수정하지 않는다.

README는 첫 실행과 상세 문서의 진입점이다. 개요와 구현 문서는 책임·동작·제약을 설명하며, 구체적인 API 사용은 Usage에 둔다. 테스트 계획과 실제 실행 결과는 분리한다.

검증 명령과 범위는 [Testing](Testing.md)에 있다. 배포 구조·의존성·공개 API를 바꾸면 전체 테스트와 실제 배포본 검증을 수행한다. 교육 기능이나 예제를 바꾸면 학생용 HTML과 교안의 대응 여부도 확인한다.
