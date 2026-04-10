# Claude Code — 자율 에이전트 관점 분석

> **소스:** `reference/claude-code/` (TypeScript, Anthropic Claude Code CLI)
> **렌즈:** 완전 자율 에이전트 설계 — agent loop, memory, planning, sub-agent, context, safety

Claude Code는 **사용자 supervised** 도구지만 내부 구조는 거의 완전 자율 에이전트에 가깝다. 우리가 만들 것의 가장 강력한 청사진.

---

## 1. 자율성 점수표

| 차원 | 점수 | 핵심 |
|---|---|---|
| Agent Loop | ★★★★★ | `query.ts` — production-grade 메시지 루프 |
| Planning | ★★★ | TaskCreate/Update 도구. 명시적 planner는 없음 |
| Memory | ★★★★ | `agentMemory.ts`, CLAUDE.md, transcript, FileStateCache |
| Tool System | ★★★★★ | `Tool.ts` — Zod 스키마 + 권한 + 동시성 + 진행상황 |
| Sub-agent 위임 | ★★★★ | `AgentTool` — local/remote 서브 에이전트 |
| Context 관리 | ★★★★★ | 자동 compact (200K), `chainId` 추적 |
| Self-correction | ★★★ | Hook 기반 후처리, 명시적 reflection 없음 |
| Safety / Sandbox | ★★★ | `canUseTool` 권한, `RemoteAgentTask` 컨테이너, sandbox 자체는 제한적 |

**총평:** 자율 에이전트의 전 구성요소가 production 수준으로 구현됨. 단, "사용자가 시키는 작업"을 잘 하도록 조정됨 — 완전 자율(목표만 주고 long-running)은 추가 설계 필요.

---

## 2. 디렉터리 지도 (자율 에이전트 관점에서 의미있는 것만)

| 디렉터리/파일 | 자율 에이전트 역할 |
|---|---|
| `query.ts` (1000+) | **메인 에이전트 루프** — LLM 호출, tool 실행, hook, compact |
| `QueryEngine.ts` (700+) | SDK/배치 모드용 wrapper |
| `Tool.ts` (800+) | Tool 인터페이스 정의 |
| `tools/` | 40+ 도구 구현체 |
| `tools/AgentTool/` | **서브에이전트 위임** |
| `tools/AgentTool/agentMemory.ts` | 에이전트별 메모리 |
| `tasks/` | 백그라운드 작업 (long-running) |
| `tasks/RemoteAgentTask/` | **격리된 컨테이너 실행** |
| `state/AppStateStore.ts` | 작업 상태, 권한, 진행 상황 |
| `context/context.ts` | `getSystemContext`, `getUserContext` (memory 로드) |
| `services/compact/` | **자동 컨텍스트 압축** |
| `hooks/` | pre/post tool use, post-sampling, pre/post compact |
| `coordinator/coordinatorMode.ts` | 마스터-워커 오케스트레이션 |
| `skills/bundled/loop.ts` | **반복 실행** (자율 루프 패턴) |
| `skills/bundled/schedule.ts` | cron 스케줄 |
| `upstreamproxy/` | 원격 세션 보안 |

---

## 3. 메인 에이전트 루프 — `query.ts`

자율 에이전트의 **심장**. 한 번의 user turn = 한 번의 `query()` 호출.

```
1. 시스템 컨텍스트 로드     ── getSystemContext() / getUserContext()
                              (Git status, CLAUDE.md, memory files)
2. 메시지 정규화           ── normalizeMessagesForAPI()
                              compact 경계 삽입
3. LLM 호출 (스트리밍)     ── prependUserContext() → client.messages.stream()
4. tool 호출 루프          ── runTools() 병렬 실행
                              hooks + canUseTool 권한
5. 포스트 샘플링           ── executePostSamplingHooks()
                              auto-mode classifier
6. Compact (필요 시)       ── calculateTokenWarningState()
                              isAutoCompactEnabled()
                              buildPostCompactMessages()
7. transcript 저장         ── recordTranscript()
                              recordSidechainTranscript()
```

### 자율 에이전트 핵심 메커니즘

- **스트리밍** — `client.messages.stream()` 부분 메시지 처리
- **병렬 도구** — `runTools()` 동시 실행 (concurrent-safe 도구만)
- **chainId 추적** — `queryTracking.chainId` (중첩 sub-agent용)
- **token 예측** — `tokenCountWithEstimation()` 사전 검사
- **프롬프트 캐싱** — 시스템 프롬프트 고정으로 KV cache 재사용

### 차용할 패턴

```ts
// 자율 루프의 본질
async function agentLoop(input, context) {
  let done = false
  while (!done) {
    const messages = await loadContext(context)
    const response = await llm.stream(messages)
    const toolCalls = extractToolCalls(response)

    if (toolCalls.length === 0) {
      done = true; break
    }

    const results = await runToolsParallel(toolCalls, context)
    context = await maybeCompact(context, results)
    await runHooks('post_tool_use', { results, context })
  }
}
```

---

## 4. Tool 시스템 (`Tool.ts`)

자율 에이전트의 **action layer**. 가장 잘 만들어진 부분.

```ts
type Tool<Input, Output, P> = {
  name: string
  aliases?: string[]
  searchHint?: string

  call(
    args: z.infer<Input>,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: AssistantMessage,
    onProgress?: ToolCallProgress<P>
  ): Promise<ToolResult<Output>>

  description(...): Promise<string>
  inputSchema: Input                    // Zod
  isConcurrencySafe(input): boolean     // 병렬 실행 안전?
  isReadOnly(input): boolean            // 사이드 이펙트 없음?
  isDestructive?(input): boolean        // 위험?
  checkPermissions(input, context): PermissionResult

  // UI 렌더링
  renderToolUseMessage(...)
  renderToolResultMessage?(...)
  renderToolUseProgressMessage?(...)
}
```

### 자율 에이전트 관점에서 핵심

| 필드 | 왜 중요한가 |
|---|---|
| `isConcurrencySafe` | 병렬 도구 실행으로 latency 줄임 |
| `isReadOnly` | 안전한 도구는 confirmation 없이 실행 가능 |
| `isDestructive` | 위험 도구는 명시적 게이트 |
| `checkPermissions` | 자율 모드에서도 안전 boundary 유지 |
| `onProgress` | long-running 도구의 가시성 |
| Zod schema | LLM 출력 검증 + 자동 retry 가능 |

### 도구 카테고리

| 카테고리 | 도구 |
|---|---|
| 파일 | FileRead, FileEdit, FileWrite |
| 검색 | Glob, Grep, ToolSearch |
| 실행 | Bash, REPL, PowerShell |
| **에이전트** | **AgentTool** |
| 상호작용 | AskUserQuestion, SendMessage |
| 작업관리 | TaskCreate/Update/List |
| MCP | MCPTool, ListMcpResources |
| 확장 | SkillTool, WebSearch, WebFetch |
| **자율** | **RemoteTrigger, loop, schedule** |

### `buildTool()` — 안전한 기본값 패턴

```ts
function buildTool(def) {
  return {
    ...TOOL_DEFAULTS,        // 권한: allow, 읽기 안전: false
    userFacingName: () => def.name,
    ...def,
  }
}
```

---

## 5. 서브에이전트 위임 (`AgentTool`)

자율 에이전트의 **위임 메커니즘**. 우리에게 가장 직접 적용 가능.

### Task 타입 (Task.ts)

```ts
type TaskType =
  | 'local_bash'
  | 'local_agent'           // 같은 프로세스 (메모리 공유)
  | 'remote_agent'          // 격리 컨테이너 (CCR)
  | 'in_process_teammate'   // 상호작용형 팀메이트
  | 'local_workflow'        // 워크플로우
  | 'monitor_mcp'           // MCP 모니터링
  | 'dream'                 // 백그라운드 분석
```

### `runAgent.ts` — 서브에이전트 생성 흐름

1. `AgentDefinition` 로드 (frontmatter `.md` 파일)
2. `initializeAgentMcpServers()` — 에이전트별 MCP 초기화
3. `resolveAgentTools()` — 부모 도구 중 일부만 노출
4. `createSubagentContext()` — 격리된 ToolUseContext
5. `query()` 재귀 호출 — 새 메시지 루프
6. `recordSidechainTranscript()` — sidechain transcript
7. `writeAgentMetadata()` — 결과 메타데이터

### Frontmatter 기반 정의 (가장 큰 차용 포인트)

```markdown
---
name: code-reviewer
description: PR을 검토하고 이슈를 찾는 에이전트
tools: [Read, Grep, Glob, Bash]
model: claude-opus-4
---

너는 시니어 코드 리뷰어다. 다음을 확인해...
```

**왜 좋은가:**
- 에이전트를 코드가 아닌 **마크다운으로 선언**
- 도구 화이트리스트로 권한 제한
- 모델 별도 지정
- 핫 리로드 가능
- 사용자가 직접 추가 가능

### 자율 에이전트 관점 평가

- ✅ **Frontmatter 정의** — 그대로 차용
- ✅ **도구 화이트리스트** — sub-agent 권한 제한
- ✅ **격리 컨텍스트** — sub-agent가 부모 메시지 못 봄
- ✅ **재귀 query()** — 같은 루프 코드 재사용
- ⚠️ **AppState 공유** — sub-agent가 글로벌 상태 수정 가능 (격리 약함)
- ⚠️ **부모 메모리 spillover** — `appendSystemMessage()`로 부모에 직접 메시지 주입 가능

---

## 6. Memory 시스템

자율 에이전트는 메모리 없이 못 산다. Claude Code는 **4계층 메모리**.

| 계층 | 위치 | 수명 | 용도 |
|---|---|---|---|
| **Working memory** | `messages` (AppState) | 현재 turn | 대화 히스토리 |
| **Session memory** | transcript 파일 | 세션 종료까지 | resume용 |
| **Long-term memory** | CLAUDE.md, `~/.claude/` | 영구 | 사용자 프로필, 프로젝트 컨벤션 |
| **Agent memory** | `agentMemory.ts` | 에이전트별 영구 | sub-agent 학습 |

### Context 로드 (`context.ts`)

```ts
const getSystemContext = memoize(async () => ({
  gitStatus: ...,           // 동적 (캐시 무효화 가능)
  cacheBreaker: ...
}))

const getUserContext = memoize(async () => ({
  claudeMd: ...,            // CLAUDE.md 자동 로드
  currentDate: ...
}))
```

### `agentMemory.ts` (Auto Memory)

`/Users/dongkseo/.claude/projects/.../memory/` — 우리가 지금 쓰고 있는 그 시스템.

- **MEMORY.md** — 인덱스 (항상 컨텍스트에 로드)
- **개별 md** — 타입별 (user/feedback/project/reference)
- **frontmatter** — name, description, type
- **자동 압축/decay** — 오래된 메모리는 stale 마킹

자율 에이전트에서 가장 중요한 부분. 우리가 만들 것에 직접 차용.

---

## 7. Context 압축 (자동 Compact) ★

장기 작업의 핵심. **이것 없으면 자율 에이전트는 컨텍스트 한계에 부딪혀 죽는다.**

### 트리거

```ts
// services/compact/
calculateTokenWarningState()    // 80% / 90% / 95%
isAutoCompactEnabled()          // 자동 모드
buildPostCompactMessages()      // 요약 후 메시지 재구성
```

### 흐름

```
1. 토큰 사용량 모니터링
2. 임계치 (예: 200K 중 180K) 도달
3. pre_compact 훅 실행
4. LLM에게 "이 대화를 요약해" 요청
5. 요약 + 최근 메시지만 남기고 나머지 폐기
6. post_compact 훅 실행
7. transcript 파일에는 원본 보존
```

### 자율 에이전트가 차용할 점

- **pre/post hook으로 사용자 데이터 보존 가능** (compact 전에 중요한 사실 추출 → memory에 저장)
- **요약 자체가 에이전트 호출** — 별도 lightweight 에이전트가 해도 됨
- **transcript 분리 보관** — 압축은 working memory에만, 원본은 추적용

---

## 8. Hook 시스템

자율 에이전트의 **확장점**.

| 시점 | 용도 |
|---|---|
| `session_start` | 세션 초기화 |
| `pre_tool_use` | 도구 호출 전 (검증, 로깅) |
| `post_tool_use` | 도구 호출 후 (자동 commit, 검증) |
| `post_sampling` | LLM 응답 후 (분류, 라우팅) |
| `pre_compact` / `post_compact` | 압축 전후 (메모리 추출) |

### settings.json 예시

```json
{
  "hooks": {
    "session_start": {
      "bash": "git status"
    },
    "post_tool_use[Bash]": {
      "condition": "git diff HEAD",
      "bash": "git add -A"
    }
  }
}
```

### 평가

- ✅ **사용자가 자율 에이전트 동작 확장 가능** (코드 수정 없이)
- ✅ **frontmatter로 에이전트별 hook**
- ⚠️ **직렬 실행** — 병렬화 미지원
- ⚠️ **명령형 등록** — pub/sub 아닌 sync 호출
- ⚠️ **실패 시 silent**

---

## 9. 자율 동작 도구: `loop`, `schedule`

`skills/bundled/`:

```bash
/loop 5m /check-deploy           # 5분마다 반복
/schedule "0 9 * * *" /standup   # 매일 9시
```

**자율 에이전트의 핵심 패턴 — Claude Code가 이미 해놨음.**

- `loop.ts` — 인터벌 기반 반복 실행 (각 반복마다 fresh context)
- `schedule.ts` — cron 기반 트리거
- `RemoteTriggerTool` — 외부 이벤트로 에이전트 깨우기

### 차용

자율 에이전트는 본질적으로 "계속 깨어나서 무언가 하는" 것 — 이 3가지 트리거 패턴이 기본 골격이 됨.

---

## 10. Safety / Permission 시스템

`canUseTool` — 모든 도구 호출 게이트.

### 권한 모드

- `allow` — 항상 허용
- `ask` — 매번 사용자에게 묻기
- `deny` — 차단
- 도구별/패턴별 세분화

### bypass / 자율 모드

`--dangerously-skip-permissions` 플래그 — 자율 모드의 안전 트레이드오프.

### `RemoteAgentTask` — 격리 컨테이너

장기/위험 작업을 별도 컨테이너로:
- Session token 인증 (`upstreamproxy.ts`)
- MCP 채널 권한 (`channelPermissions.ts`)
- 환경 격리

**자율 에이전트 시사점:** 자율도가 높을수록 격리 강도도 높여야 함.

---

## 11. 우리가 차용할 핵심 패턴 (정리)

### 그대로 가져올 것

1. **메인 루프 구조** (`query.ts`) — load → llm → tools → compact → hook
2. **Tool 인터페이스** (`Tool.ts`) — Zod + 권한 + 동시성 + 진행상황
3. **Frontmatter 기반 sub-agent 정의**
4. **자동 compact + pre/post hook으로 메모리 추출**
5. **4계층 memory** (working / session / long-term / agent)
6. **MEMORY.md 인덱스 패턴** — 항상 로드되는 작은 인덱스
7. **`loop` / `schedule` / `RemoteTrigger`** — 자율 트리거 3종
8. **`isConcurrencySafe` / `isReadOnly` / `isDestructive`** — 도구 안전 메타데이터

### 보강해야 할 것

1. **Planning 단계** — 명시적 planner 에이전트 (Deep Agents 참고)
2. **Self-reflection** — 에러/실패 후 자기 점검 루프
3. **장기 목표 추적** — 단일 turn 너머 goal state machine
4. **Sub-agent 격리 강화** — AppState 공유 제거
5. **Hook → Pub/Sub 업그레이드** — 병렬화 + 비동기

### 피해야 할 것

1. **AppState 중앙화** — 자율 모드에서 경합 발생
2. **거대 ToolUseContext** (10+ 필드) — 의존성 추적 불가
3. **Hook 직렬 실행** — long-running 작업 블로킹
4. **단일 거대 query.ts (10K+ 라인)** — 단일 책임 위반

---

## 12. 핵심 파일 레퍼런스

| 파일 | 라인 | 무엇을 봐야 하는가 |
|---|---|---|
| `query.ts` | ~1000 | 메인 루프 전체 흐름 |
| `Tool.ts` | ~800 | Tool 인터페이스 + buildTool |
| `tools/AgentTool/runAgent.ts` | ~150 | sub-agent 생성/실행 |
| `tools/AgentTool/agentMemory.ts` | - | 에이전트 메모리 |
| `services/compact/*` | - | 자동 compact 로직 |
| `context/context.ts` | - | memory 로드 |
| `state/AppStateStore.ts` | ~500 | 상태 모델 (반면교사) |
| `tasks/RemoteAgentTask/*` | - | 격리 컨테이너 패턴 |
| `skills/bundled/loop.ts` | - | 반복 실행 패턴 |
| `skills/bundled/schedule.ts` | - | 스케줄 패턴 |
| `coordinator/coordinatorMode.ts` | - | 마스터-워커 |
| `hooks/*` | - | 확장점 패턴 |
