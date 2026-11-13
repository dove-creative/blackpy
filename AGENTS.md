# AGENTS

## 프로젝트 범위

- BlackPy는 Windows x64에서 학생 Python 파일을 로컬 웹 무대에서 실행하는 교육용 프로그램이다.
- 이 저장소는 실행부, 웹 무대, Python 지원 모듈, 시작 코드 예제, 빌드·배포·테스트를 관리한다.
- 교육 기능이나 예제를 바꿀 때 수업 자료에 미치는 영향을 확인한다. 공개 문서에는 외부 수업 자료의 저장소 링크와 보관 위치를 기재하지 않는다.
- 학생에게 내부 프레임워크나 통신 구현을 요구하지 않는다. 아직 제공하지 않는 입력·접촉 판정·아이템·점수·소리를 사용 가능한 기능으로 안내하지 않는다.

## 참조 문서

- 작업 전 `README.md`와 `docs`의 관련 문서를 확인한다. 사용법은 Usage, 책임·동작·제약은 Overview와 Implementation, 테스트 계획은 Testing, 실제 결과는 검증 기록에 둔다.
- 공통 컨벤션과 작업 지침은 `guidelines/blackthunder-conventions` 서브모듈에서 필요한 문서만 읽는다.
- 서브모듈이 비어 있으면 `git submodule update --init --recursive -- guidelines/blackthunder-conventions`로 초기화한다. 실패하면 해당 사실을 알린다.
- 적용 우선순위는 프로젝트 지침·설정 → 언어별 컨벤션 → 공통 컨벤션이다.
- 기술 문서는 `conventions/01. dove Documentation Convention.md`와 `instructions/문서 양식.md`를 따른다. README는 일반 README 템플릿과 CSharp README 템플릿을 따른다.
- 이 문서에서 `conventions`·`instructions`로 시작하는 경로는 `guidelines/blackthunder-conventions` 아래를 가리킨다.
- 서브모듈은 이 저장소가 기록한 커밋을 사용한다. 컨벤션을 갱신하면 CHANGELOG를 검토하고 프로젝트 지침과의 충돌 여부를 확인한다.

## 언어

- 사용자와 한국어로 대화할 때는 존댓말을 사용한다.
- 기술 문서는 `~이다` 체로 작성한다. Git 커밋 제목은 영어로 작성한다.
- 내부 구현 주석은 영어를 기본으로 한다. 학생용 예제·Python 지원 모듈의 교육 설명·오류 메시지는 한국어 이해를 우선한다.
- 교육용 코드에 영어 주석이나 클래스 중심의 영역 구분을 일괄 적용하지 않는다.

## 파일 형식

- 코드와 프로젝트 설정 파일은 UTF-8·LF를 기본으로 한다.
- BAT 원본과 배포본은 UTF-8 무BOM·CRLF를 사용한다. 한글 경로를 사용하는 BAT는 코드페이지 65001을 적용한다.
- `.gitattributes`의 줄 끝 규칙을 유지한다. 마크다운 파일은 개행 문자로 끝낸다.
- 기존 인코딩 때문에 편집 도구가 실패하면 파일 손상으로 판단하지 않고 해당 인코딩으로 읽어 필요한 범위만 변환한다.

## 개발 언어별 기준

### C#

- `conventions/02. dove CSharp Convention.md`와 `instructions/플랫폼 기준 - CSharp.md`를 읽는다.
- 실행부의 대상은 .NET 10, C# 언어 버전은 9이다. nullable을 사용하며 implicit using은 사용하지 않는다.
- `.csproj`, `.props`, `.targets`, 솔루션 파일에도 LF 규칙을 적용한다.

### Python

- `conventions/02. dove Python Convention.md`의 PEP 8과 공통 규칙을 따른다.
- 학생 실행 환경은 Python 3.10 이상이다. BlackPy 설치형 외의 Python 실행 의존성은 현재 제공하지 않는다. wheel 빌드와 편집기 검증용 도구는 개발 환경에만 설치한다.
- 교육 예제는 학생의 이해와 수업 진도를 우선한다. C 계열의 영역 구분과 120자 줄 길이 규칙을 Python에 적용하지 않는다.

### JavaScript와 PowerShell

- 전용 언어 문서가 없으면 `conventions/02. dove Common Convention.md`에서 해당 언어에 적용되는 절을 읽는다.
- JavaScript 테스트는 Node.js 22 이상, 배포 스크립트는 PowerShell 7을 기준으로 한다.

## 의존성과 배포

- BlackPy 버전은 항상 `숫자.숫자.숫자` 형식만 사용한다. 개발·공개 구분을 위한 접미사는 붙이지 않으며, 다른 설치본을 구분해야 하면 세 자리 안에서 버전을 올린다.
- UniEngine과 BlackboxSystem은 `packages`의 NuGet 패키지로 참조한다. 소스 서브모듈의 변경을 빌드에 반영하려면 패키지도 명시적으로 갱신한다.
- UniEngine 소스 서브모듈은 접근 권한이 필요하다. 일반 빌드에 전체 서브모듈 초기화를 요구하지 않는다.
- BlackPy가 BlackboxSystem을 직접 참조하여 최종 앱에서 UE와 같은 버전을 사용한다. 선택한 버전은 UE와 바이너리 호환성을 유지해야 한다.
- 패키지를 갱신하면 서브모듈 커밋·버전·프로젝트 참조·`packages/source-manifest.json`·라이선스 고지를 함께 확인한다. 검증 후 참조되지 않는 이전 `.nupkg`는 제거한다.
- 배포 스크립트는 기존 학생 Python 파일과 `project.json`을 덮어쓰거나 삭제하지 않는다. 새 기본 프로젝트 원본은 `distribution/project`이다.
- 새 학생 프로젝트는 바깥에 학생이 편집하는 Python 파일만 두고 설정·편집기 안내·실행 도구는 `_blackpy` 폴더에 모은다. 폴더 배포본의 공통 실행부는 `실습/_blackpy/_runtime`에 두며 실습 폴더 전체를 함께 전달한다. 기존 프로젝트의 파일은 자동 이동하거나 덮어쓰지 않는다.
- pip 설치형은 Windows x64 wheel로 배포한다. 공통 실행부·기본 프로젝트 원본을 Python 패키지 안에 두고 학생 프로젝트는 설치 경로 밖에 생성한다. wheel은 새 임시 배포본에서 만들며 학생이 편집한 배포 폴더를 패키징하지 않는다.
- 샘플 진입점은 해당 Python 환경에 설치된 BlackPy만 사용한다. 미설치 상태에서는 설치 안내 후 종료하며 저장소의 `artifacts` 실행부로 대체하지 않는다. 폴더 배포용 진입점을 샘플에 생성하지 않는다.
- PyPI 공개는 `.github/workflows/publish.yml`의 GitHub Actions Trusted Publishing을 사용한다. 등록된 저장소·워크플로·`pypi` 환경을 일치시키고 장기 PyPI API 토큰을 저장하지 않는다. 공개 작업에만 `id-token: write`를 부여하며 전체 검증을 통과한 동일 wheel을 업로드한다. 공개 실행 조건과 최초 publisher 등록 절차는 `docs/Development.md`를 따른다.
- 새 프로젝트와 샘플의 `__builtins__.pyi`는 편집기용 명령 안내이다. 명령 경고를 없애기 위해 일반 이름 오류 진단을 끄거나 학생 코드에 프레임워크 import를 요구하지 않는다. 기존 사용자 정의 안내 파일과 편집기 설정은 보존한다.
- 기존 단일 `main.py` 실행 방식과 15개 놀이 예제는 지원하지 않는다. 이전 학생 폴더는 자동 변환하지 않고 새 배포 폴더를 사용한다.
- 배포물에는 BlackPy와 의존 라이브러리, 동봉 런타임의 라이선스·제3자 고지를 포함한다.
- 브라우저 저장소에 학생의 답·완료 상태나 실행 기록을 저장하지 않는다. 학생의 Python 파일 저장과 구분한다.

## 검증

- 이름만 바뀌어 동작이 달라지지 않는 변경은 빌드로 확인한다. 동작 변경은 해당 테스트를 수행한다.
- 여러 모듈, 공개 API, 빌드 설정·의존성, 배포·패키징 변경은 `docs/Testing.md`의 전체 테스트를 수행한다.
- 학생 파일을 테스트 대상으로 직접 수정하지 않고 임시 복사본을 사용한다.
- 실행 환경·통과 수치·오류·미검증 범위는 실제 결과로 기록한다. 과거 결과를 새 변경의 검증으로 재사용하지 않는다.
- 별도 장비·외부 서비스가 필요한 추가 검증은 현재 요청 범위와 접근 권한을 확인한 뒤 진행한다.
