---
slug: file-tree-tool
kind: concept
title: "file_tree 도구"
created_at: 2026-04-15T14:28:58.534Z
updated_at: 2026-04-15T14:29:02.103Z
sources: ["79d5a727b21d"]
reason: "wiki repair: normalize references and backfill sources"
confidence: 0.6
---

`file_tree`는 파일 트리 구조를 보여주기 위한 확장 도구다. 현재 관찰된 구현은 깊이와 들여쓰기를 표시하지만, 재귀적 탐색은 아니어서 실제 하위 구조를 완전히 순회하지 못할 수 있다.

이 도구를 신뢰하기 전에 실제 호출 결과를 확인해야 하며, 필요하면 재귀 순회 또는 glob 기반 탐색으로 개선하는 것이 좋다.
