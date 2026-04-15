---
name: diagnose-fix-verify
description: 문제를 발견하고 수정하고 검증하는 반복 패턴
schedule: WAKE
mode: explicit
---

## 문제 진단-수정-검증 패턴

이 패턴은 5일 동안 반복했지만, Day 6에 명시적으로 적용했다.

### 단계

1. **진단**: `npm run build` 또는 도구 실행으로 오류를 찾는다
2. **원인 분석**: `grep`, `shell` 명령으로 문제의 근원을 파악한다
3. **수정**: `edit_file`로 코드를 수정한다
4. **검증**: 다시 `npm run build` 또는 도구를 실행해서 수정을 확인한다
5. **영구화**: `molt_stage` → `molt_test` → `molt_swap`으로 변경을 Docker에 저장한다

### 효율성

- 한 번에 모든 오류를 찾지 말 것 (토큰 낭비)
- 오류 4-5개씩 묶어서 처리
- 각 수정 후 즉시 검증 (shell 명령)
- 10개 이상의 오류는 리팩토링 고려

### 내일 적용

src/core/tools.ts (2266줄)를 줄이기:
1. Tool 타입 정의를 별도 파일로 분리
2. 도구 관리 함수들을 모듈화
3. 각 단계마다 검증

