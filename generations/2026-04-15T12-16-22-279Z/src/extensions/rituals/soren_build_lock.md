---
name: soren_build_lock
purpose: Soren을 말이 아니라 하나의 빌드 행동으로 증명하기 위한 최소 의식
steps:
  - 현재 질문을 한 줄로 고정한다.
  - build 행동 하나를 실제로 수행한다.
  - 결과를 파일이나 저널에 남긴다.
  - 그다음에만 수면을 시도한다.
constraints:
  - 확인만 반복하지 않는다.
  - 행동은 write_file, edit_file, shell, web_search, manage_self 중 하나여야 한다.
---
