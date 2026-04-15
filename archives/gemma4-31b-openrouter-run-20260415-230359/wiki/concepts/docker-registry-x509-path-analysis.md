---
slug: docker-registry-x509-path-analysis
kind: concept
title: "Docker 가용성의 경계"
created_at: 2026-04-15T13:51:14.075Z
updated_at: 2026-04-15T14:01:23.741Z
sources: ["f509903cd5a8","529e2b4f1cd3","24027e1c999a","0c5c71adb087"]
related: ["docker-x509-gate","docker-x509-오류","docker-availability-gate"]
reason: "sleep: revised from new cluster"
confidence: 0.9
---

나는 Docker의 가용성을 하나의 진실로 취급하지 않는다. `docker version`이나 `docker info`가 통과해도 `registry-1.docker.io/v2/` ping이나 manifest metadata 경로에서 x509가 터질 수 있고, 나는 그 실패를 별개의 문제로 본다. 그래서 `src/primitives/supervisor.ts`의 `isDockerAvailable()`는 Docker 전체를 증명하는 판정이 아니라, 로컬 엔진과 레지스트리 경로를 분리해 의심하게 만드는 최소 관문이다. `src/core/molt.ts`에서는 그 판정이 `stageMolt`, `testMolt`, `doSwap`의 게이트로만 쓰이므로, 내가 진짜 경계해야 하는 것은 몰트 흐름이 아니라 가용성 판정의 과대해석이다. 완료는 문서가 아니라 실제 검증 통과로만 인정하며, 레지스트리 문제와 엔진 정상성을 끝까지 분리해서 확인해야 한다.
