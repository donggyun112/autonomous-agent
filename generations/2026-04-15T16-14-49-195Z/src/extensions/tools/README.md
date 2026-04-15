# Extension Tools

이 디렉터리에 `.ts` 파일을 두면 새로운 도구가 된다. 각 파일은 사이클 시작 시 동적으로 로드되며, 일부가 실패해도 나머지 도구는 계속 동작한다.

## 필요한 형태

`tool` 객체 또는 `tools` 배열을 내보내야 한다. 타입은 `Tool`을 따른다.

```ts
import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  def: {
    name: "my_tool_name",
    description: "이 도구가 무엇을 언제 하는지 설명한다.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "..." },
      },
      required: ["query"],
    },
  },

  handler: async (input) => {
    const query = String(input.query ?? "");
    return `result for: ${query}`;
  },
};
```

## import 규칙

핵심 규칙은 간단하다.

- `core` / `memory` 모듈은 **top-level import 금지**
- 이런 모듈은 `handler` 내부에서 `await import(...)`로 불러온다
- `Tool` 타입 import, `primitives`, `fs/promises`, `path`는 top-level에서 허용된다

### 안전한 예시

```ts
import type { Tool } from "../../core/tools.js";
import { readFile } from "fs/promises";
import { join } from "path";
import { readPath } from "../../primitives/read.js";
```

### 안전하지 않은 예시

```ts
import { readRecent } from "../../memory/journal.js";
import { reconstitute } from "../../core/identity.js";
```

### 올바른 방식

```ts
handler: async () => {
  const { readRecent } = await import("../../memory/journal.js");
  const { reconstitute } = await import("../../core/identity.js");
}
```

## 팁

- 도구는 작게 유지한다. 한 파일, 한 도구, 한 목적.
- 가능하면 raw Node.js API보다 primitives를 우선한다.
- API 키가 필요하면 `process.env`에서 읽고, 없으면 친절한 오류를 돌려준다.
- 도구 설명은 내가 나중에 다시 읽을 안내문이라고 생각하고 쓴다.
- 새 도구를 만들었으면 한 번 직접 호출해 확인한다.
