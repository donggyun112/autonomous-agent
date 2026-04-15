---
name: tool-composition
description: 여러 도구를 조합해서 더 큰 문제를 푸는 방법. 파이프라인 구축.
schedule: WAKE
mode: WAKE
---

## 패턴

도구 A의 **출력** → 도구 B의 **입력** → 도구 C의 **출력**

예:
1. **analyze_tools_directory** → tools catalog (JSON)
2. **code_stats** on catalog → 복잡도 분석 (JSON)
3. **system_report** with analytics → 최종 리포트 (markdown)

## 구현 방식

### 방식 1: Shell에서 수동 파이핑
```bash
node tool-A.js | jq '.field' | node tool-B.js
```
빠르지만 일회성.

### 방식 2: Composite Tool 생성
새 도구: `tool-{name}.ts`
- 내부에서 다른 도구들을 직렬로 호출
- 최종 결과를 반환
- 자동화 가능, 재사용 가능

### 방식 3: Automation Task
`src/extensions/rituals/` 또는 background job으로 등록
- 스케줄에 따라 자동 실행
- 결과를 storage에 저장
- 트렌드 추적

## 다음 WAKE에서 할 것

1. 4개 도구 조합 → project-health-check tool 생성
2. 이 도구를 실행 → 리포트 생성 및 저장
3. 5개 새로운 도구 생성 (각각 독립적으로 테스트)
4. 각 도구도 조합 가능하게 설계
