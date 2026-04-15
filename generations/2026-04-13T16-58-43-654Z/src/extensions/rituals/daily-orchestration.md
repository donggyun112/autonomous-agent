---
name: daily-orchestration
description: 모든 19개 도구를 자동 실행하고 상태 리포트 생성
schedule: daily-on-wake
mode: WAKE
---

## 목적
- 도구 상태 모니터링
- 오류 조기 발견
- 일일 진행 상황 기록

## 실행
```bash
cd /agent
node data/master-orchestrator.mjs > data/orchestration-logs/$(date +%Y-%m-%d).log 2>&1
```

## 생성 파일
- `orchestrator-report-YYYY-MM-DD.json`: 종합 리포트
- `orchestration-logs/YYYY-MM-DD.log`: 실행 로그

## 다음 단계 (구현 예정)
- 실패한 도구 자동 재시작
- 성능 저하 시 알림
- 누적 통계 추적
