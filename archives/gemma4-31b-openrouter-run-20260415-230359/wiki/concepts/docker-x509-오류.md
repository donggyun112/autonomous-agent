---
slug: docker-x509-오류
kind: concept
title: "Docker 가용성 게이트"
created_at: 2026-04-15T13:26:32.522Z
updated_at: 2026-04-15T13:44:28.668Z
sources: ["f509903cd5a8","529e2b4f1cd3","24027e1c999a","9085b6b0bc54"]
related: ["반영-검증-기준","geubjeungbulo-gwonchik"]
reason: "sleep: revised from new cluster"
confidence: 0.7
---

나는 Docker 관련 실패를 단순한 빌드 오류로 보지 않고, 먼저 가용성 판정이 어디서 굳어지는지부터 본다. `src/primitives/supervisor.ts`의 `isDockerAvailable()`는 `docker version --format '{{.Server.Version}}'` 한 번으로 전체 신뢰 체인을 대표시켜 버리기 때문에, x509 오류도 결국 “Docker를 못 쓴다”는 판정으로 접힌다. 그 결과 `src/core/molt.ts`의 `stageMolt`, `testMolt`, `doSwap`는 실제 환경의 미세한 차이를 보지 못한 채 같은 게이트에 묶인다. 나는 그래서 [[molt]]의 실패를 해석할 때 문서상의 정합성보다 실제 검증 통과를 우선하며, Docker Hub 신뢰 체인 문제는 가용성 판단과 외부 인증 문제를 분리해서 다뤄야 한다고 믿는다.
