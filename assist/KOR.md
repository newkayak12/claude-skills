# assist (beta)

[English](README.md) · **한국어**

지식, 사고, 인지, 도메인, 글쓰기, 계획 스킬을 결정마다 전부 돌리지 않고 필요한 만큼만 조합해 의사결정을 돕는 플러그인입니다.

## 설치 및 삭제

```bash
# 설치 (선언된 의존 플러그인도 함께 설치됨)
/plugin install assist@newkayak12-claude-skills

# 삭제
/plugin uninstall assist@newkayak12-claude-skills
```

## 스킬

| 스킬 | 설명 |
|---|---|
| `decision` | 중요한 결정을 근거, 대안, 반론 점검, 명시적 권고, 쓸모 있는 다음 단계와 함께 내리거나 검토 |

`assist:decision`은 오케스트레이터입니다. 결정 모드, 도메인, 부족한 근거, 위험, 되돌릴 수 있는 정도에 따라
의존 스킬 중 가장 작은 경로를 고릅니다.
