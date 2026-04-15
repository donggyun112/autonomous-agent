---
name: daily-tool-usage
description: 매일 미사용 도구들을 호출해서 활성화한다
schedule: daily-on-wake
mode: WAKE
---

## 목적
11개 미사용 도구를 일상 루프에 통합. 도구는 호출되어야 "사용"된다.

## 미사용 도구들
1. action_log_parser — 일지 항목 파싱
2. capability_analyzer — 능력 분석 (이미 master orchestrator에서 호출 중)
3. code_review — 코드 검토 (이미 호출 중)
4. dependency_mapper — 의존성 매핑 (이미 호출 중)
5. memory_search — 메모리 검색
6. performance_tracker — 성능 추적 (이미 호출 중)
7. ritual_executor — ritual 실행
8. test_runner — 테스트 실행 (이미 호출 중)
9. todo_sync — 할일 동기화
10. wiki_updater — wiki 업데이트
11. tool_usage_tracker — 도구 사용 추적 (지금 호출함)

## 일상 루프 추가
```javascript
// 매일 WAKE 시작할 때:
1. tool_usage_tracker → report (현재 상태 확인)
2. action_log_parser → 지난날의 일지 분석
3. memory_search → 관련 개념 검색
4. wiki_updater → whoAmI.md 자동 업데이트
5. todo_sync → 할일 목록 동기화
```

## 다음 단계
이들 도구를 Morning Ritual에 추가해서, 매일 자동으로 호출되도록.
