# Molt Protocol — 쉘 교체 가이드

## 개요

Molt는 에이전트가 자기 자신을 새 Docker 이미지로 교체하는 프로토콜이다.
`src/` 파일만 바꾸는 게 아니라 **전체 Docker 이미지**(OS, Node, 의존성, 소스)를 새로 빌드한다.

## 3단계 프로세스

```
molt_stage(reason, patch) → molt_test(generationId) → molt_swap(generationId)
```

### 1. molt_stage — 새 이미지 빌드

현재 빌드 컨텍스트를 `generations/<id>/`에 복사하고, patch를 적용한 뒤 `docker build`로 새 이미지를 만든다.

**patch 형식:**
```json
{
  "reason": "왜 이 변경을 하는지",
  "patch": [
    {
      "rel_path": "src/extensions/tools/my-tool.ts",
      "content": "// 전체 파일 내용"
    }
  ]
}
```

### 2. molt_test — 격리 테스트

새 이미지를 `--network none` (네트워크 차단) 환경에서 실행해 self-test를 돌린다.
현재 에이전트는 건드리지 않음 — 실패해도 안전.

### 3. molt_swap — 교체

새 이미지를 `autonomous-agent:current`로 리태그하고 exit 75로 종료.
Docker compose가 자동 재시작하면서 새 이미지로 부팅.

---

## ⚠️ 핵심 규칙: Dockerfile의 FROM

**절대 `FROM <이미지ID>`를 쓰지 마라.** Docker가 레지스트리에서 찾으려 하므로 실패한다.

### ✅ 올바른 방법

Dockerfile을 수정하지 않는다. 원본 그대로 유지:

```dockerfile
FROM node:22-bookworm-slim
```

`--pull=never` 옵션이 이미 적용되어 있으므로, 로컬에 `node:22-bookworm-slim` 이미지가 있으면 레지스트리 접근 없이 빌드된다.

### ❌ 하지 말 것

```dockerfile
FROM 1a4367344ecc              # 이미지 ID → 레지스트리 조회 시도 → x509 에러
FROM 1a4367344ecc249bc189...   # 전체 SHA → "cannot specify 64-byte hex" 에러
FROM day1-escape-attempt       # 커스텀 태그 → 레지스트리 조회 → x509 에러
```

### Dockerfile 변경이 필요한 경우

기본 Dockerfile을 **그대로** 두고, `src/` 파일만 patch로 수정하라.
Dockerfile은 이미 올바르게 구성되어 있다.

---

## patch 작성 가이드

### 새 도구 추가 (가장 일반적)

```json
{
  "reason": "DNS 조회 도구 추가",
  "patch": [
    {
      "rel_path": "src/extensions/tools/dns-lookup.ts",
      "content": "import type { Tool } from '../../core/tools.js';\n\nexport const tool: Tool = {\n  def: {\n    name: 'dnsLookup',\n    description: 'DNS 조회',\n    input_schema: {\n      type: 'object',\n      properties: { domain: { type: 'string' } },\n      required: ['domain'],\n    },\n  },\n  handler: async (input) => {\n    const { execFileSync } = await import('child_process');\n    return execFileSync('nslookup', [String(input.domain)], { encoding: 'utf-8', timeout: 5000 });\n  },\n};"
    }
  ]
}
```

### 기존 파일 수정

`rel_path`에 기존 파일 경로를 쓰면 해당 파일이 **완전히 교체**된다.
부분 수정은 불가 — 전체 파일 내용을 `content`에 넣어야 한다.

### 여러 파일 동시 수정

```json
{
  "patch": [
    { "rel_path": "src/extensions/tools/tool-a.ts", "content": "..." },
    { "rel_path": "src/extensions/tools/tool-b.ts", "content": "..." },
    { "rel_path": "src/extensions/rituals/new-ritual.md", "content": "---\nname: new-ritual\n..." }
  ]
}
```

---

## 흔한 실패와 해결

| 에러 | 원인 | 해결 |
|------|------|------|
| `x509: certificate signed by unknown authority` | Docker가 레지스트리 접근 시도 | Dockerfile의 FROM을 수정하지 마라. 원본 유지. |
| `cannot specify 64-byte hexadecimal strings` | FROM에 전체 SHA 사용 | FROM에 이미지 ID/SHA 쓰지 마라. |
| `ENOENT: no such file or directory` | import 경로 오류 | `../../core/tools.js` 형태의 상대 경로 사용 |
| `TypeError: tool.handler is not a function` | export 형식 오류 | `export const tool: Tool = { ... }` 형식 필수 |
| Build timeout (10분) | 파일이 너무 크거나 빌드 복잡 | patch 크기 줄이기, 한 번에 하나씩 |

---

## extensions/ 구조

```
src/extensions/
  tools/        ← 도구 (.ts 파일, export const tool: Tool 필수)
  rituals/      ← 리추얼 (.md 파일, YAML frontmatter 필수)
  subagents/    ← 서브에이전트 (.md 파일)
```

**도구 로더가 기대하는 형식:**
```typescript
// src/extensions/tools/my-tool.ts
import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  def: {
    name: "myToolName",
    description: "도구 설명",
    input_schema: { type: "object", properties: { ... }, required: [...] },
  },
  handler: async (input) => {
    // 실행 로직
    return "결과 문자열";
  },
};
```

---

## 체크리스트 (molt 전 확인)

- [ ] Dockerfile을 수정하지 않았는가? (원본 유지)
- [ ] patch의 rel_path가 정확한가?
- [ ] TypeScript import 경로가 `../../core/tools.js` 형식인가?
- [ ] `export const tool: Tool = { ... }` 형식을 따르는가?
- [ ] handler가 문자열을 반환하는가?
- [ ] 파일 내용에 구문 오류가 없는가?
