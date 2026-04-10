# 완전 자율 에이전트 — 레퍼런스 분석

> **목표:** 완전 자율 에이전트 (autonomous agent) 설계를 위한 3개 오픈소스 분석.
> **렌즈:** Agent Loop, Planning, Memory, Tool, Sub-agent, Context, Self-correction, Safety.

---

## 문서

| 레퍼런스 | 언어 | 한 줄 요약 | 분석 |
|---|---|---|---|
| **Claude Code** | TypeScript | Production-grade agent loop + tool system + memory의 결정판 | [`claude-code.md`](./claude-code.md) |
| **Deep Agents** | Python (LangGraph) | 자율 에이전트의 **개념 모델** — planning + filesystem + sub-agent 삼위일체 | [`deepagents.md`](./deepagents.md) |
| **OpenClaw** | TypeScript (monorepo) | **장시간 작업 + sandbox + 외부 에이전트 호출**의 인프라 | [`openclaw.md`](./openclaw.md) |

---

## 자율성 8차원 종합 비교

| 차원 | Claude Code | Deep Agents | OpenClaw |
|---|---|---|---|
| Agent Loop | ★★★★★ | ★★★★ | ★★★ |
| Planning | ★★★ | ★★★★★ | ★★ |
| Memory | ★★★★ | ★★★★ | ★★★ |
| Tool System | ★★★★★ | ★★★★ | ★★★★ |
| Sub-agent 위임 | ★★★★ | ★★★★★ | ★★★★ |
| Context 관리 | ★★★★★ | ★★★★ | ★★ |
| Self-correction | ★★★ | ★★★ | ★★★ |
| Safety / Sandbox | ★★★ | ★★ | ★★★★★ |

**셋이 정확히 다른 강점을 가짐 — 합치면 완전체.**

---

## 차용 패턴 매트릭스

| 컴포넌트 | 출처 | 무엇 |
|---|---|---|
| **메인 루프** | Claude Code `query.ts` | load → llm → tools → compact → hook |
| **Tool 인터페이스** | Claude Code `Tool.ts` | Zod + 권한 + 동시성 + 진행상황 |
| **`isConcurrencySafe` / `isReadOnly` / `isDestructive`** | Claude Code | 도구 안전 메타데이터 |
| **자동 Compact** | Claude Code `services/compact/` | 토큰 임계치 + pre/post hook |
| **4계층 Memory** | Claude Code | working / session / long-term / agent |
| **MEMORY.md 인덱스 패턴** | Claude Code `agentMemory.ts` | 항상 로드되는 작은 인덱스 |
| **`loop` / `schedule` / `RemoteTrigger`** | Claude Code skills | 자율 트리거 3종 |
| **Frontmatter sub-agent 정의** | Claude Code `AgentTool` | 마크다운으로 에이전트 선언 |
| **Hook 시스템** | Claude Code `hooks/` | settings.json 외부 확장 |
| **`write_todos` planning** | Deep Agents `TodoListMiddleware` | 외부화된 working memory |
| **3-tier sub-agent** | Deep Agents `subagents.py` | sync / compiled / async |
| **`_EXCLUDED_STATE_KEYS`** | Deep Agents | 부모/자식 상태 분리 |
| **Filesystem as memory** | Deep Agents `FilesystemMiddleware` | 컨텍스트 한계 우회 |
| **`BackendProtocol`** | Deep Agents `backends/protocol.py` | storage 추상화 정석 |
| **`ralph_mode` 반복 루프** | Deep Agents `examples/` | 장기 자율 작업 패턴 |
| **Default middleware stack** | Deep Agents `graph.py:207` | 최소 stack 청사진 |
| **BASE_AGENT_PROMPT** | Deep Agents | 자율 동작 가이드 |
| **ProcessSupervisor + scopeKey** | OpenClaw `src/process/supervisor/` | 장시간 작업 추적/취소 |
| **`SpawnMode: "child" \| "pty"`** | OpenClaw | 대화형 CLI 자동화 |
| **Docker sandbox 3-tier** | OpenClaw `Dockerfile.sandbox*` | 단계별 격리 |
| **`coding-agent` 스킬** | OpenClaw `skills/coding-agent/` | 외부 자율 도구 호출 |
| **호출 메타필드 4종** | OpenClaw `gateway/protocol/schema/agent.ts` | idempotency / lane / provenance / spawnedBy |
| **`TerminationReason` enum** | OpenClaw `supervisor/types.ts` | 정확한 종료 사유 |
| **워크스페이스 격리** | OpenClaw `agent-scope.ts` | 에이전트별 디렉터리 |

---

## 자율 에이전트 minimum viable feature set

3개 분석을 종합한 **최소 자율 에이전트 구성**:

```
┌─────────────────────────────────────────────────┐
│ 1. AGENT LOOP                                   │
│    load_context → llm → tool_calls →            │
│    parallel_execute → compact? → hooks → loop   │
│    [출처: Claude Code query.ts]                  │
├─────────────────────────────────────────────────┤
│ 2. PLANNING                                     │
│    write_todos 도구로 외부화                     │
│    매 turn 시작에 todos 읽기                     │
│    [출처: Deep Agents TodoListMiddleware]        │
├─────────────────────────────────────────────────┤
│ 3. MEMORY (4계층)                                │
│    - working: messages                           │
│    - session: transcript file                    │
│    - long-term: MEMORY.md + AGENTS.md            │
│    - agent: agent별 frontmatter md               │
│    [출처: Claude Code + Deep Agents]             │
├─────────────────────────────────────────────────┤
│ 4. TOOL SYSTEM                                  │
│    Zod 스키마 + 권한 + concurrency + progress    │
│    isReadOnly / isDestructive 메타데이터         │
│    [출처: Claude Code Tool.ts]                   │
├─────────────────────────────────────────────────┤
│ 5. FILESYSTEM AS WORKING MEMORY                 │
│    read/write/edit_file, ls/glob/grep            │
│    BackendProtocol 추상화                        │
│    [출처: Deep Agents FilesystemMiddleware]      │
├─────────────────────────────────────────────────┤
│ 6. SUB-AGENT (3-tier)                           │
│    in-process / compiled / process-isolated      │
│    frontmatter 정의                              │
│    [출처: Deep Agents + Claude Code AgentTool]   │
├─────────────────────────────────────────────────┤
│ 7. CONTEXT COMPACT                              │
│    토큰 임계치 → LLM 요약                        │
│    pre/post hook으로 메모리 추출                 │
│    [출처: Claude Code services/compact]          │
├─────────────────────────────────────────────────┤
│ 8. PROCESS SUPERVISION                          │
│    RunRecord + scopeKey + TerminationReason      │
│    PTY 모드 지원                                 │
│    [출처: OpenClaw ProcessSupervisor]            │
├─────────────────────────────────────────────────┤
│ 9. SANDBOX (default on)                         │
│    Docker 3-tier                                 │
│    network 격리, 자원 quota                      │
│    [출처: OpenClaw Dockerfile.sandbox*]          │
├─────────────────────────────────────────────────┤
│ 10. 자율 트리거                                  │
│     loop / schedule / external trigger           │
│     ralph_mode 반복 루프                         │
│     [출처: Claude Code skills + Deep Agents]     │
├─────────────────────────────────────────────────┤
│ 11. 호출 메타필드                                │
│     idempotencyKey, lane, provenance, spawnedBy  │
│     [출처: OpenClaw schema/agent.ts]             │
├─────────────────────────────────────────────────┤
│ 12. SELF-CORRECTION                             │
│     BASE_AGENT_PROMPT 가이드                     │
│     실패 → reflection → retry                    │
│     [강화 필요 — 3개 다 약함]                    │
└─────────────────────────────────────────────────┘
```

---

## 셋 다 약한 부분 (우리가 새로 풀어야)

| 부족한 것 | 왜 중요한가 |
|---|---|
| **명시적 self-reflection 단계** | 자율 모드에서 사용자 피드백 없이 자기 교정 |
| **장기 목표 state machine** | 단일 turn 너머 다단계 목표 추적 |
| **무한 루프 / 비용 폭주 가드** | 자율도가 높을수록 안전망 필수 (`spawnedBy` 깊이, 토큰 budget, 시간 제한) |
| **외부 사건 기반 trigger** | "이벤트가 오면 깨어나는" 진정한 reactive 루프 |
| **에이전트 간 학습 공유** | sub-agent가 배운 것을 부모/형제에게 전달 |
| **결과 검증 루프** | 도구 출력이 의도한 바를 달성했는지 LLM 자체 검증 |

---

## 차용 우선순위 (우리 구현 순서 제안)

1. **Agent Loop** (Claude Code 패턴) — 가장 먼저, 나머지가 다 여기 위에 올라감
2. **Tool System** (Claude Code 인터페이스 + Deep Agents middleware 패턴 합치기)
3. **Filesystem + BackendProtocol** (Deep Agents 그대로)
4. **Memory 시스템** (Claude Code MEMORY.md + Deep Agents AGENTS.md 합치기)
5. **`write_todos` planning** (Deep Agents)
6. **자동 compact** (Claude Code)
7. **Sub-agent 위임** (frontmatter 정의 + 3-tier)
8. **ProcessSupervisor + Sandbox** (OpenClaw — 위험 작업 시작 전 필수)
9. **자율 트리거** (loop/schedule)
10. **Self-correction 루프** (직접 설계 — 레퍼런스 부족)

---

## 분석 메타

- 분석 일자: 2026-04-10
- 렌즈: 완전 자율 에이전트 (autonomous agent) 설계
- 범위: 자율성 8차원 평가 + 차용 가능 패턴 추출
- 한계: 점진적 코드 변화 가능 — 인용된 라인 번호는 분석 시점 기준
