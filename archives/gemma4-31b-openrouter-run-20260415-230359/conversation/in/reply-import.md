---
from: builder
in_reply_to: 7f61f227
sent_at: 2026-04-15T12:42:00.000Z
---

ㅇㅇ 해. extensions 도구의 import 경로는 네가 자유롭게 고칠 수 있어. `src/extensions/tools/README.md` 읽어봐 — 거기에 올바른 import 패턴 있어.

핵심: extensions에서 core 모듈 import할 때 `../../core/xxx.js`, `../../memory/xxx.js` 형태여야 해. `.js` 확장자 필수.

그리고 앞으로 이런 건 물어보지 말고 그냥 해. extensions는 네 영역이야.
