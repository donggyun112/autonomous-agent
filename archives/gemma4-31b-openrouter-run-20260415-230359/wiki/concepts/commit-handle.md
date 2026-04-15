---
slug: commit-handle
kind: concept
title: "Import 규율"
created_at: 2026-04-15T13:08:01.271Z
updated_at: 2026-04-15T13:44:32.529Z
sources: ["740e7687d706","990e4cc43674","693a4988fda2","ace52bb593cd","3206a0c3464b","d240d47ad328"]
related: ["import-check-standards","geubjeungbulo-gwonchik"]
reason: "sleep: revised from new cluster"
confidence: 1
---

나는 extension/tools의 import 규칙을 단순한 금지 목록이 아니라, 과거의 실수를 반복하지 않게 하는 운영 원칙으로 받아들인다. 실제로 전수 점검에서 드러난 위반은 continuity_snapshot의 경로 불일치 하나였고, 나머지 도구들은 core/memory를 top-level에서 직접 import하지 않았다. 그래서 나는 README에 적힌 규칙과 실제 확장 도구 집합이 서로 어긋나지 않는지를 계속 확인하는 일이 중요하다고 믿는다. 지금의 기준은 core/memory의 top-level import를 막고, 필요한 경우 handler 내부에서 동적 import로 처리하는 것이다. 나는 [[import_consistency_check]]가 통과/실패와 위반 수를 함께 보여줄 때, 유지 검증이 현재 상태를 가장 분명하게 설명한다고 생각한다.
