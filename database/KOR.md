# database — 한국어

[English](README.md) · **한국어**

MySQL, MariaDB, PostgreSQL, Oracle을 읽기 전용으로 조회합니다. DB마다 MCP 서버가 하나씩
(`readonly-mysql`, `readonly-mariadb`, `readonly-postgres`, `readonly-oracle`, 프로필도 따로) 있고,
스킬 네 개가 맞는 서버를 골라 씁니다.

| 스킬 | 하는 일 |
|---|---|
| `database:login` | host/port/user/database를 물은 뒤 서버가 macOS 비밀번호 창을 띄웁니다. 비밀번호는 Keychain에 저장(1Password `op://`는 옵션). 접속을 시험합니다. |
| `database:logout` | 프로필에 저장된 비밀번호를 지웁니다. host/user/database는 남깁니다. |
| `database:profile` | 프로필(local, dev, stage, prod)을 보여주거나 커넥션을 바꿉니다. prod는 이름을 말할 때만 바꾸며 확인 창은 없습니다. |
| `database:query` | 스키마를 보고 읽기 전용 쿼리를 실행합니다. 답마다 프로필을 밝힙니다. |

```
dev로 로그인하고 최근 주문 10건 보여줘.
```

- **읽기 전용 이중 보호.** DB가 쓰기를 거부합니다. MySQL/MariaDB는 세션에 `SET SESSION TRANSACTION
  READ ONLY`, PostgreSQL은 접속 시 `default_transaction_read_only=on`, Oracle은 호출마다
  `SET TRANSACTION READ ONLY` 후 롤백하고, 모두 문장 시간 제한을 겁니다. `query`도 읽기 문장 하나만
  받고, 잠금 읽기, INTO, sleep, 파일·네트워크 접근, SQL 문자열을 실행하는 함수(`query_to_xml`,
  `DBMS_XMLGEN`), 실행되는 주석, WITH·EXPLAIN 안의 DML을 거부합니다.
- **비밀번호는 대화를 거치지 않습니다**: 비밀번호를 인자로 받는 도구가 없습니다.
- **행**은 스트리밍으로 읽다가 1000행에서 끊습니다(`truncated: true`). prod에서는 200행, 문장당 10초입니다.
- **개인정보는 결과에서 빠집니다**: 이름, 전화번호, 주소, 우편번호, 이메일 같은 컬럼을 원본 컬럼명
  기준으로 모든 결과에서 빼므로 별칭으로도 꺼낼 수 없습니다. 뺀 컬럼은 `hidden`에 나옵니다. 계산
  컬럼은 그 식이 개인정보 컬럼을 읽을 때만 뺍니다. Oracle은 원본 컬럼을 알려주지 않아 컬럼 이름과
  SELECT 식으로 판단합니다. `--pii off`(`DBRO_PII`)로 끄고, `--pii regex,regex`로 목록을 바꿉니다.
- **조회 기록**: 모든 조회가 `~/.config/database-readonly-mcp/query.log`에 남습니다. 문자열 값은 `'?'`로
  바뀌고 결과 값은 적지 않습니다.

설치: 필요 없습니다. 플러그인이 드라이버까지 묶은 파일 하나로 서버 네 개(`plugin:database:readonly-<vendor>`)를
띄우므로 설치나 업데이트에 npm도 네트워크도 필요 없습니다(Oracle은 Thin 모드라 Instant Client도 필요 없음).
0.9.0 전에 저장한 MySQL 로그인은 `readonly-mysql`이 그대로 씁니다. 0.6.0 이하에서 남은 사용자 범위 `database-readonly`는
지웁니다(`claude mcp remove database-readonly -s user`). 자세한 내용: [`mcp/readonly/README.md`](mcp/readonly/README.md).
