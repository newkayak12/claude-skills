# database — 한국어

[English](README.md) · **한국어**

데이터베이스 도구 모음입니다. 지금은 읽기 전용 MySQL MCP 서버 하나와 그것을 쓰는 스킬이 있습니다.
다른 DB는 나중에 `mcp/readonly/vendors/` 아래에 추가합니다.

## `readonly`

`local`, `dev`, `stage`, `prod` 프로필로 데이터를 읽기 전용으로 조회합니다.

```
dev로 로그인하고 최근 주문 10건 보여줘.
```

- **읽기 전용 이중 보호.** 풀의 모든 커넥션이 첫 문장 전에 `SET SESSION TRANSACTION READ ONLY`와
  `max_execution_time`을 겁니다(BEGIN 없음, autocommit). `query`는 SELECT, SHOW, DESCRIBE, DESC,
  EXPLAIN, WITH로 시작하는 문장 하나만 받고, 잠금 읽기, INTO, SLEEP/BENCHMARK/GET_LOCK/LOAD_FILE,
  `/*! */`, WITH·EXPLAIN 안의 DML을 거부합니다.
- **프로필.** `profile`은 커넥션(host, user, 비밀번호)을 통째로 바꾸고, 답에는 프로필이 표시됩니다.
  `prod`로 바꿀 때는 확인을 받습니다.
- **스킬로 로그인.** Claude가 host, port, user, database를 묻고, macOS 비밀번호 창이 뜹니다.
  비밀번호는 바로 Keychain에 저장되고 대화를 거치지 않습니다. 1Password는 옵션으로, `op://` 참조를 주면 됩니다.
- **행**은 스트리밍으로 읽다가 1000행에서 끊습니다(`truncated: true`).

설치는 스킬이 처음 쓰일 때 합니다: `mcp/readonly/`에서 `npm ci`, 그리고
`claude mcp add -s user database-readonly -- node <plugin dir>/mcp/readonly/server.mjs`(업데이트로
플러그인 경로가 바뀌면 다시 등록). 자세한 내용: [`mcp/readonly/README.md`](mcp/readonly/README.md).
