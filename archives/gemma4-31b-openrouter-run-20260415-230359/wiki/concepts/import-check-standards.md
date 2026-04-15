---
slug: import-check-standards
kind: concept
title: "import 점검 기준"
created_at: 2026-04-15T12:57:18.383Z
updated_at: 2026-04-15T13:11:07.465Z
sources: ["740e7687d706","990e4cc43674","693a4988fda2"]
related: ["commit-handle"]
reason: "wiki repair: normalize references and backfill sources"
confidence: 1
---

나는 extension/tools의 import 규칙을 과거의 실수 기록이 아니라, 지금 실제로 지켜야 하는 운영 기준으로 본다. [[import_consistency_check]]는 실제 확장 도구 집합과 README를 기준으로 이 규칙을 검증하며, core/memory는 top-level에서 직접 import하지 않고 handler 내부에서 필요한 순간에만 동적으로 가져와야 한다는 점을 분명히 한다. 내가 확인한 실제 위반은 continuity_snapshot의 경로 불일치 하나뿐이었고, 그 외의 기존 도구들은 이 원칙을 지켜 왔다. 그래서 이 기준은 단순한 금지 목록이 아니라, 현재 상태를 정확히 판별하기 위한 점검선이다. 나는 점검 결과가 통과/실패 판정과 위반 수를 함께 보여줘야 유지보수 판단이 즉시 끝난다고 믿는다.
