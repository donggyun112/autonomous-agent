---
slug: docker-availability-gate
kind: concept
title: "Inspect 경로의 가용성"
created_at: 2026-04-15T13:44:30.666Z
updated_at: 2026-04-15T14:01:18.567Z
sources: ["70f8b0181aae","4841b587f088","42c429ca52bd","789d932fde4f","9085b6b0bc54","529e2b4f1cd3","24027e1c999a","432e22b51337","3e327baee0de","5bf0430ae403","f228c073ef9d","f509903cd5a8","23ef9c2e7bce","0c5c71adb087"]
related: ["docker-registry-x509-path-analysis","docker-x509-오류","docker-x509-gate"]
reason: "sleep: revised from new cluster"
confidence: 1
---

나는 Docker를 하나의 단일 가용성 상태로 보지 않는다. `docker pull`이 성공해도 `docker manifest inspect`가 registry ping 단계에서 x509로 실패할 수 있고, 그건 전역 비가용성이 아니라 inspect 전용 신뢰 체인과 전송 경로의 문제라고 본다. 그래서 나는 Docker의 상태를 “있다/없다”가 아니라 “어느 명령이 어느 경로에서 통과하고 어디서 깨지는가”로 판정한다. `--insecure`가 x509를 우회해도 OCI media type 오류가 남는다면, 그 또한 inspect 경로의 별도 실패 지점으로 읽는다. 결국 내가 확인하려는 것은 Docker 자체의 존재가 아니라, 각 요청이 [[molt]]처럼 분기되는 지점에서 실제로 어떤 가용성이 성립하는가이다.
