# skill 플러그인 — 로드맵

작성 2026-10-12, skill 1.5.1 기준.

## 제안 — `skill:update` (설치·업데이트가 안 될 때)

`audit`은 워크스페이스에 **무엇이 있는지**를 봅니다. **설치·업데이트 자체가 실패할 때**를
다루는 스킬이 없습니다. `harness:update`는 하네스 복사본 전용이라 다른 층입니다.

### 근거 — 2026-10-12 실제 세션

한 사용자가 플러그인 하나를 못 받는 데 세션 하나가 들어갔습니다. UI 메시지 셋 다 원인을
말해주지 않았습니다:

```
/plugin marketplace update   →  "could not be refreshed"             원인 없음
Add Marketplace (SSH)        →  "git clone exited with code 1 (no stderr)"
Add Marketplace (owner/repo) →  같은 메시지
```

실제 원인 둘이 섞여 있었습니다:

1. **arm64 Mac의 x86_64 Homebrew git (2022년, Rosetta 없음)** — git이 에러를 낸 게 아니라
   뜨지 못했습니다. `exit 1 + stderr 없음`이 그 증상입니다.
2. **이미 등록된 마켓플레이스를 다시 추가** — 대상 디렉터리가 비어 있지 않아 clone 실패.
   UI는 "이미 있다"고 말하지 않습니다.

그리고 **CLI로는 같은 명령이 통과**했습니다 (`claude plugin marketplace update`). UI 쪽
실패 경로와 CLI 경로가 다릅니다.

### 범위

| 증상 | 확인 |
|---|---|
| refresh 실패 | `git --version`이 실제로 실행되는지, 바이너리 arch 불일치 |
| clone 실패 | 대상 디렉터리가 이미 존재하는지 — git의 원문 메시지를 그대로 노출 |
| 인증 실패 | remote가 SSH인지, 그 프로세스에 ssh-agent가 붙는지 |
| 올렸는데 그대로 | 디스크 버전 vs 설치본 vs **재시작 필요 여부** |
| 스킬이 안 잡힘 | 캐시 경로에 파일이 실제로 있는지 |

**UI가 실패하면 CLI로 우회**를 기본 경로로 둡니다.

덤으로 같은 세션에서 본 것: 캐시에 옛 버전이 계속 쌓이고(`graph` 12개 버전, 18MB),
리포에서 deprecated한 플러그인이 설치본에 남아 있었습니다. 정리도 같은 스킬에서 봅니다.

### 의존성

없음. deck-builder 로드맵과 완전히 독립이라 아무 때나 착수 가능합니다.
