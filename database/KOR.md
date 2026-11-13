# database — 한국어

[English](README.md) · **한국어**

MCP 서버 하나(`database-readonly`, 지금은 MySQL; 다른 DB는 `mcp/readonly/vendors/`에 추가)와 그것을
쓰는 스킬 네 개로 데이터베이스를 읽기 전용으로 조회합니다.

| 스킬 | 하는 일 |
|---|---|
| `database:login` | 처음 쓸 때 서버를 설치·등록하고, host/port/user/database를 물은 뒤 서버가 macOS 비밀번호 창을 띄웁니다. 비밀번호는 Keychain에 저장(1Password `op://`는 옵션). 접속을 시험합니다. |
| `database:logout` | 프로필에 저장된 비밀번호를 지웁니다. host/user/database는 남깁니다. |
| `database:profile` | 프로필(local, dev, stage, prod)을 보여주거나 커넥션을 바꿉니다. prod는 확인을 받습니다. |
| `database:query` | 스키마를 보고 읽기 전용 쿼리를 실행합니다. 답마다 프로필을 밝힙니다. |

```
dev로 로그인하고 최근 주문 10건 보여줘.
```

- **읽기 전용 이중 보호.** 풀의 모든 커넥션이 첫 문장 전에 `SET SESSION TRANSACTION READ ONLY`와
  `max_execution_time`을 겁니다(BEGIN 없음, autocommit). `query`는 SELECT, SHOW, DESCRIBE, DESC,
  EXPLAIN, WITH로 시작하는 문장 하나만 받고, 잠금 읽기, INTO, SLEEP/BENCHMARK/GET_LOCK/LOAD_FILE,
  `/*! */`, WITH·EXPLAIN 안의 DML을 거부합니다.
- **비밀번호는 대화를 거치지 않습니다**: 비밀번호를 인자로 받는 도구가 없습니다.
- **행**은 스트리밍으로 읽다가 1000행에서 끊습니다(`truncated: true`).
- **개인정보는 결과에서 빠집니다**: 이름, 전화번호, 주소, 우편번호, 이메일 같은 컬럼을 원본 컬럼명
  기준으로 모든 결과에서 빼므로 별칭으로도 꺼낼 수 없습니다. 뺀 컬럼은 `hidden`에 나옵니다.
  `--pii off`(`DBRO_PII`)로 끄고, `--pii regex,regex`로 목록을 바꿉니다.

설치(`database:login`이 합니다): `mcp/readonly/`에서 `npm ci`, 그리고
`claude mcp add -s user database-readonly -- node <plugin dir>/mcp/readonly/server.mjs`. 업데이트로
플러그인 경로가 바뀌면 다시 합니다. 자세한 내용: [`mcp/readonly/README.md`](mcp/readonly/README.md).
