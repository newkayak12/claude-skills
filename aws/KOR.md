# aws — 한국어

[English](README.md) · **한국어**

AWS CLI를 읽기 전용으로 씁니다. MCP 서버 하나(`readonly-aws`)에 도구 네 개(`profile`, `login`,
`logout`, `query`)가 있고, 스킬 네 개가 이를 움직입니다. macOS 전용입니다. IAM 사용자 액세스 키
(Access Key ID + Secret Access Key)와 선택 MFA 세션만 쓰며, 역할(AssumeRole)은 지원하지 않습니다.

| 스킬 | 하는 일 |
|---|---|
| `aws:login` | 이름 붙은 프로필을 저장합니다. 서버가 macOS 숨김 입력 창으로 키를 받아 Keychain에 넣거나 1Password에서 읽습니다. `sts get-caller-identity`로 시험합니다. |
| `aws:logout` | 프로필의 캐시된 세션을 로컬에서 지웁니다. `forget: true`면 저장된 키도 지웁니다. |
| `aws:profile` | 프로필을 계정, 리전, 세션 만료와 함께 보여주거나 활성 프로필을 바꿉니다. |
| `aws:query` | 읽기 전용 AWS CLI 호출 하나를 실행합니다. 답마다 프로필, 계정, 리전을 밝힙니다. |

```
dev(ap-northeast-2)로 로그인하고 EC2 인스턴스 목록 보여줘.
```

## 로그인

- **프로필**: 이름은 `[a-z0-9_-]{1,32}`, 리전, 선택 `label`(기본값은 `sts get-caller-identity`의 계정 ID).
- **숨김 입력 창**(기본): 키를 macOS 숨김 입력 창에 입력하면 Keychain 서비스 `readonly-aws`, 계정
  `<profile>`에 저장됩니다. 키를 인자로 받는 도구가 없어 키는 대화를 거치지 않습니다.
- **1Password**: `vault`와 `item`을 넘기면 서버가 `access key id`, `secret access key` 필드(대소문자
  무시)를 `op item get`으로 읽고, MFA 일련번호가 있으면 일회용 코드를 `op item get --otp`(첫 6자리
  토큰)로 읽습니다. 참조만 저장합니다.
- **MFA(선택)**: `mfa_serial`을 넘기면(프로필 파일에 저장) 로그인이 `sts get-session-token`을
  **129600초(36시간)**, 즉 IAM 사용자 최대로 요청합니다. 거부되면 43200, 그다음 3600으로 낮춥니다.
  돌려받은 `Expiration`을 항상 보여줍니다. 세션은 Keychain 계정 `<profile>:session`에 캐시되고 만료되면
  조용히 갱신합니다. 30 s 구간 안에서 이미 쓴 TOTP 코드는 거부되며, 조용한 재로그인은 명확한 오류를
  내고 구간이 지난 뒤 한 번 다시 시도합니다.
- **MFA 일련번호 없음**: 저장된 장기 키를 그대로 쓰며 `profile`은 만료를 `none`으로 보여줍니다.

## 로그아웃

캐시된 세션을 로컬에서 지우고 만료 시각을 알려줍니다. STS 토큰은 폐기할 수 없어 `Expiration`까지
유효합니다. `forget: true`는 저장된 키(또는 1Password 참조)도 지웁니다. MFA 일련번호가 없으면 세션이
없으므로 로그아웃이 그렇게 알려줍니다.

## 조회

- **한도**: 출력은 1 MiB에서 끊고, 호출마다 60 s 시간 제한이 있습니다.
- **기록**: 모든 호출이 `~/.config/aws-readonly-mcp/query.log`(권한 0600, 5 MB에서 롤링)에 명령
  형태만 남고 값은 적지 않습니다.
- **데이터 영역 읽기는 허용됩니다.** `lambda get-function-configuration`(환경 변수),
  `dynamodb get-item`, `logs get-log-events`, `athena get-query-results` 같은 `get-*`는 비밀이나
  데이터를 돌려줄 수 있습니다. 실제 한도는 IAM `ReadOnlyAccess` 정책이므로 IAM 사용자에게 이 정책만
  붙이길 권합니다. DB 행은 `database:query`로 갑니다.

### 읽기 전용 규칙

프롬프트가 아니라 서버가 거부합니다. 거부되면 `rejected [rule]: ...`가 돌아옵니다.

- **허용**: `describe-*`, `list-*`, `get-*`, `lookup-*`, `search-*`; `sts get-caller-identity`;
  `s3://` URI를 준 `s3 ls`만.
- **거부**:
  - `secretsmanager get-secret-value`
  - `ssm get-parameter`, `get-parameters`, `get-parameters-by-path`, `get-parameter-history`의 `--with-decryption`
  - `kms decrypt`, `kms generate-data-key*`
  - `ls`를 뺀 고수준 `s3` 명령; `s3 presign`
  - `s3api get-object`, `get-object-torrent`, 출력 파일을 쓰는 모든 작업
  - `--output-file`
  - `lambda invoke`
  - `sts get-session-token`, `sts get-federation-token`
  - `eks get-token`
  - `ecr get-login-password`, `ecr get-authorization-token`
  - `ec2 get-password-data`
  - `--endpoint-url`, `--profile`, `--cli-input-*`
  - `--query`, `--max-items`, `--page-size`, `--no-paginate`를 뺀 모든 전역 플래그
  - `file://`, `fileb://`, `http://`, `https://`로 시작하는 인자 값

설치: `aws` CLI가 PATH에 있어야 하며, 없으면 서버가 'aws CLI not installed → aws:login installs it'라고 답하고 `aws:login`이 AWS CLI v2를 설치합니다(brew, 없으면 공식 pkg; 비밀번호를 물을 수 있음). `op`는 1Password 로그인에만
필요합니다. 플러그인이 묶인 파일 하나로 `plugin:aws:readonly-aws`를 띄우므로 설치에 npm도 네트워크도
필요 없습니다.
