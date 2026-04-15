---
name: tool-async-fixer
description: 로드 실패한 도구의 async handler를 동기 함수로 변환한다
schedule: on-demand
mode: WAKE
triggers:
  - "tool loading fails"
  - "no exported tool found"
---

## 문제
새 도구들이 `export async function handler` 형식으로 정의되면 내장 로더가 인식하지 못해 로드 실패.

## 해결 절차
1. 도구 파일 읽기
2. `export async function handler` 찾기
3. `async` 키워드 제거 (동기 함수로 변환)
4. 도구 다시 로드 테스트

## 자동화
```bash
cd src/extensions/tools
for file in *.ts; do
  if grep -q "export async function handler" "$file"; then
    sed -i 's/export async function handler/export function handler/g' "$file"
  fi
done
```

## 참고: Day 4 실제 사례
10개 도구 모두 동일한 문제로 로드 실패 → 일괄 수정 → 100% 성공
