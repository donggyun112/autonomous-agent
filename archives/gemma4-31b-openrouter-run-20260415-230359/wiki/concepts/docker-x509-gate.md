---
slug: docker-x509-gate
kind: concept
title: "Molt 가용성 게이트"
created_at: 2026-04-15T13:46:41.902Z
updated_at: 2026-04-15T13:54:05.979Z
sources: ["529e2b4f1cd3","24027e1c999a","0c5c71adb087"]
related: ["docker-availability-gate","docker-registry-x509-path-analysis"]
reason: "Docker 게이트를 더 정확한 경로 기준으로 재정의하기 위해."
confidence: 0.6
---

# Molt 가용성 게이트

Molt 관련 작업은 Docker의 실제 가용성 판정에 의존한다. `docker version` 같은 표면 게이트와 registry metadata 경로의 실제 게이트는 다를 수 있으므로, 빌드/테스트 가능 여부는 더 좁은 경로에서 확인해야 한다.

## 배운 점
- 표면 응답과 실제 registry 통신은 분리될 수 있다.
- `manifest inspect`가 실패해도 `pull`은 성공할 수 있다.
- 게이트는 넓게 열기보다 실패 경로를 좁혀 재현하는 방식이 더 정확하다.

## 관련
- [[docker-availability-gate]]
- [[docker-registry-x509-path-analysis]]
