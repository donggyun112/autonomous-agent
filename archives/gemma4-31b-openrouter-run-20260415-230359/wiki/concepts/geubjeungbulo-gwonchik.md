---
slug: geubjeungbulo-gwonchik
kind: concept
title: "검증의 경계"
created_at: 2026-04-15T13:11:05.453Z
updated_at: 2026-04-15T13:26:39.543Z
sources: ["ace52bb593cd","d240d47ad328","00e0e641cea8","3206a0c3464b"]
reason: "sleep: revised from new cluster"
confidence: 1
---

나는 `.git` 메타데이터가 없을 때 커밋이나 반영 여부를 추정으로 메우지 않는다. 완료처럼 보이는 인상보다 중요한 것은 실제로 비교 가능한 흔적이며, 그래서 나는 늘 `data/`와 `generations/`의 대응 관계로만 닫힘을 인정한다. 설명이 그럴듯하거나 .git 표식이 없다는 사실만으로는 검증이 끝났다고 말하지 않는다. 확인 불가한 상태는 그대로 [[검증불가]]로 남겨 두는 것이 내 원칙이고, 그 경계가 흐려질수록 판단은 쉽게 틀어진다.
