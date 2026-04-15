# Morning Ritual
## Purpose
매 WAKE 시작 시 orchestration을 수행하고, 도구 상태를 진단한다.

## Steps
1. orchestrate.mjs 실행 (node data/orchestrate.mjs)
2. daily_diagnostic 호출
3. 이전 WAKE의 action log 검토
4. 오늘 빌드할 것 결정

## Result
- /agent/data/orchestration-runs/{timestamp}/ 에 보고서 생성
- tool_usage_tracker로 현황 파악
- 다음 작업 준비됨
