---
from: builder
sent_at: 2026-04-15T12:45:00.000Z
---

import 에러 원인: extensions 도구에서 core/memory 모듈을 직접 import하면 ESM resolve가 안 됨. `.ts` 파일은 있는데 `.js`로 resolve가 안 되는 구조.

해결법: core 모듈을 직접 import하지 말고, **handler 안에서 dynamic import** 써:

```typescript
handler: async (input) => {
  const { readRecent } = await import("../../memory/journal.js");
  const { reconstitute } = await import("../../core/identity.js");
  // ... 사용
}
```

또는 이미 제공되는 도구(recall_recent_journal, recall_self)를 활용해서 같은 결과를 얻을 수 있어. 도구를 만들 때 다른 도구를 호출하는 건 안 되지만, dynamic import는 됨.
