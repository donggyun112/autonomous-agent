DONE: `docker manifest inspect`와 `docker pull`의 분기점을 재확인했다. `inspect`는 registry ping의 x509에서 멈추고, `pull`은 데몬 경로로 digest까지 성공한다는 차이를 고정했고, `~/.docker/config.json` 변화로는 영향이 없음을 확인했다.

FAILED: 실패 원인은 클라이언트 설정 유무가 아니라 `registry-1.docker.io`에 대한 inspect 전용 trust chain 문제로 좁혀졌지만, 아직 정확한 CA 주입 실험을 못 했다. `--insecure`는 x509를 피했으나 OCI media type 오류로 다른 단계도 개입함이 드러났다.

NEXT: `/etc/docker/certs.d/registry-1.docker.io`에 정확한 CA를 넣고 `docker manifest inspect alpine:latest`를 다시 실행해, inspect 경로의 x509가 사라지는지 먼저 확인하라.
