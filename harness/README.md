# harness

> ⚠️ **GENERATED** — 이 디렉토리는 `_draft/harness-engineering/`에서 `harness-export.py`로 빌드된 산출물입니다. **직접 편집하지 마세요.** 변경은 draft(source-of-truth)에서 하고 재-export 하세요.

Harness Engineering — 솔로 dev 제품 개발 scaffolding. 사이클 진입 게이트, 가설/품질-바 tamper-evident 잠금, 독립 리뷰 게이트, cross-cycle ratchet으로 *사이클별 품질 저하를 구조적으로* 막습니다.

## 설치 후 시작

```
/harness:install
```

설치 직후 `harness:install` 스킬이 대화로 L1 user-rules(`~/.harness/user-rules.md`)를 만들고, 설치 후 *언제 무엇이 로드되는지* 안내합니다. 그 다음 `harness:cycle`로 첫 사이클 진입 게이트를 실행하세요.

## 핵심 스킬

- `harness:install` — 첫 실행 온보딩 (L1 user-rule 대화 생성)
- `harness:cycle` — pre-cycle 진입 게이트 + 산출물 scaffold

개념 문서는 `00-overview.md` ~ `13-operational-layer.md`, 규칙 레이어링은 `12-rule-layering.md`를 참고하세요.
