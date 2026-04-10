# OpenClaw — 자율 에이전트 관점 분석

> **소스:** `reference/openclaw/` (TypeScript, pnpm monorepo)
> **렌즈:** 완전 자율 에이전트 설계

OpenClaw는 메시징 채널 통합 봇 프레임워크지만 자율 에이전트 관점에서 가장 가치 있는 부분은 **장시간 백그라운드 작업 + sandbox + skill system + 외부 코딩 에이전트 위임**. Claude Code와 Deep Agents가 약한 "위험 작업 격리 + 장기 실행"을 가장 잘 풀었음.

---

## 1. 자율성 점수표

| 차원 | 점수 | 핵심 |
|---|---|---|
| Agent Loop | ★★★ | Gateway WS RPC 기반, 직접 LLM 루프는 약함 |
| Planning | ★★ | 명시적 planner 없음 |
| Memory | ★★★ | memory plugin (core/lancedb), 워크스페이스 격리 |
| Tool System | ★★★★ | skill 기반, PTY 모드 강력 |
| Sub-agent 위임 | ★★★★ | **외부 코딩 에이전트 위임 (코덱스/Claude Code/Pi)** ★ |
| Context 관리 | ★★ | session 기반, 자동 압축은 약함 |
| Self-correction | ★★★ | spawnedBy 호출 체인 추적 |
| **Safety / Sandbox** | **★★★★★** | **Docker 3종 + ProcessSupervisor + scopeKey** ★ |

**총평:** **장시간 / 위험 작업 실행 인프라**가 압도적으로 강함. 자율 에이전트의 "act" 단계 — 특히 장시간 실행과 격리 — 의 청사진.

---

## 2. 자율 에이전트 관점에서 가장 가치 있는 부분

OpenClaw 전체를 다 볼 필요 없음. 자율 에이전트에 직접 차용 가능한 4가지:

1. **ProcessSupervisor + scopeKey** — 장시간 작업 추적/취소
2. **Docker sandbox 3종** — 단계별 격리 전략
3. **PTY 모드 + 백그라운드 실행** — 대화형 CLI 자동화
4. **Coding-agent skill** — 외부 자율 도구 위임 패턴

나머지(Gateway, channels, ACP, plugin SDK)는 멀티테넌트/메시징 봇용이라 우리에게 less relevant.

---

## 3. ProcessSupervisor — 장시간 작업의 골격 ★

`src/process/supervisor/types.ts`

```typescript
type RunState = "starting" | "running" | "exiting" | "exited";

type TerminationReason =
  | "manual-cancel"
  | "overall-timeout"
  | "no-output-timeout"
  | "spawn-error"
  | "signal"
  | "exit";

type RunRecord = {
  runId: string;
  sessionId: string;
  backendId: string;
  scopeKey?: string;          // 범위 격리 키 ★
  pid?: number;
  state: RunState;
  terminationReason?: TerminationReason;
  // 타임스탬프, 종료 코드/신호
};

type SpawnMode = "child" | "pty";
```

### 자율 에이전트가 차용할 점

#### `scopeKey` — 범위 기반 그룹 취소

- 같은 scope의 모든 프로세스를 한 번에 cancel 가능
- 자율 에이전트가 "이 작업 그룹 다 죽여" 할 때 필수
- 예: sub-agent가 spawn한 모든 프로세스를 sub-agent 종료 시 같이 정리

#### `TerminationReason` — 종료 원인 추적

자율 에이전트가 작업 실패 원인을 학습하려면 정확한 종료 사유 필요:
- `overall-timeout` vs `no-output-timeout` vs `manual-cancel` vs `spawn-error`
- LLM에 "왜 죽었는지" 알려줘야 다음 시도가 똑똑해짐

#### `SpawnMode: "child" | "pty"`

- `child` — 일반 프로세스
- `pty` — 의사 터미널 (대화형 CLI 필수)

### 어댑터 패턴

```
src/process/supervisor/adapters/
├ child.ts        # 표준 child process
├ pty.ts          # PTY (interactive CLI)
└ env.ts          # 환경변수 관리
```

---

## 4. PTY 모드 — 대화형 도구 자동화 ★

자율 에이전트가 codex, claude, opencode, pi 같은 **대화형 CLI**를 호출하려면 PTY가 필수.

### Skill 예시 (`skills/coding-agent/SKILL.md`)

```yaml
---
name: coding-agent
description: "배경 프로세스로 코딩 작업 위임.
  Codex/Claude Code/Pi 에이전트 사용.
  기능 구축, PR 검토, 대규모 리팩토링."
metadata:
  openclaw:
    emoji: "🧩"
    requires:
      anyBins: ["claude", "codex", "opencode", "pi"]
---
```

### 호출 패턴

```bash
# PTY 모드 + 백그라운드
bash pty:true workdir:~/project background:true \
  command:"codex exec --full-auto 'Build a snake game'"

# 백그라운드 모니터링
process action:log    sessionId:XXX
process action:poll   sessionId:XXX
process action:submit sessionId:XXX data:"yes"
```

### 자율 에이전트 시사점

**자율 에이전트가 다른 자율 에이전트를 도구처럼 호출.** 우리가 만들 자율 에이전트는:
- Claude Code를 sub-process로 호출 (PTY)
- Codex, Aider 등도 같은 패턴
- 각 호출이 백그라운드 → 메인 루프는 폴링/이벤트 대기
- stdin으로 사용자 입력 시뮬레이션 (`process action:submit data:"yes"`)

**이것이 "에이전트가 에이전트를 쓰는" 가장 실용적인 패턴.**

---

## 5. Docker Sandbox — 3-tier 격리 ★

자율 에이전트는 **위험한 명령**을 실행한다. Sandbox 없이는 자율 모드 불가.

### 3가지 이미지

#### `Dockerfile.sandbox` — 최소 격리
```dockerfile
FROM debian:bookworm-slim
RUN useradd --create-home --shell /bin/bash sandbox
USER sandbox
WORKDIR /home/sandbox
CMD ["sleep", "infinity"]
```
- 비-root, 최소 패키지
- "여기서 뭘 해도 호스트는 안전" 보장

#### `Dockerfile.sandbox-common` — 개발 도구
- Node.js, Python3, Go, Rust, Cargo, Git, jq
- pnpm, Bun, Homebrew
- build-essential, libasound2-dev
- → 자율 에이전트가 코드 빌드/테스트 가능

#### `Dockerfile.sandbox-browser` — GUI 브라우저
```dockerfile
RUN apt-get install -y --no-install-recommends \
  chromium fonts-liberation xvfb x11vnc novnc
EXPOSE 9222 5900 6080  # DevTools, VNC, noVNC
```
- → 자율 에이전트가 웹 자동화 (Playwright 등)

### 설정 (`docs/cli/sandbox.md:122-146`)

```jsonc
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",            // off | non-main | all
        "scope": "agent",         // session | agent | shared
        "docker": {
          "image": "openclaw-sandbox:bookworm-slim",
          "containerPrefix": "openclaw-sbx-"
        },
        "prune": {
          "idleHours": 24,
          "maxAgeDays": 7
        }
      }
    }
  }
}
```

### 자율 에이전트 차용 전략

| 작업 종류 | 격리 수준 |
|---|---|
| 읽기 전용 (cat, grep) | 호스트 직접 |
| 파일 수정 | 워크스페이스 격리 |
| 명령 실행 (bash, npm) | sandbox-common |
| 웹 자동화 | sandbox-browser |
| 미지의 코드 실행 | sandbox 최소 + network 차단 |

### 핵심 통찰

**자율도가 높을수록 sandbox 강도도 높아져야 한다.** 사용자가 매번 confirm 안 해주니까.

---

## 6. 외부 자율 에이전트 호출 패턴

OpenClaw `coding-agent` 스킬은 본질적으로:

```
OpenClaw (자율 에이전트)
  └─ skill: coding-agent
      └─ 외부 자율 에이전트 (Claude Code, Codex 등) 호출
          └─ PTY 백그라운드 실행
              └─ 폴링으로 결과 수집
```

### 우리에게 직접 차용 가능

자율 에이전트의 sub-agent 위임은 3가지 형태:

1. **In-process sub-agent** — 같은 LLM 다른 프롬프트 (Claude Code, Deep Agents)
2. **Process-isolated sub-agent** — sandbox/container 안의 자기 복제
3. **외부 도구로서의 자율 에이전트** — codex/claude/aider를 PTY로 호출 (OpenClaw)

3번이 가장 실용적. 우리 자율 에이전트가 "이 작업은 Claude Code가 더 잘함" 판단하면 PTY로 호출 → 결과 받아옴.

---

## 7. Memory — 워크스페이스 격리

`src/agents/agent-scope.ts`

```typescript
function listAgentIds(cfg: OpenClawConfig): string[] {
  const agents = listAgentEntries(cfg);
  if (agents.length === 0) return [DEFAULT_AGENT_ID];
  // ...
}
```

### 에이전트별 디렉터리 격리

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "main",
        "workspace": "~/my-workspace",       // ★ 독립 디렉터리
        "model": { ... },
        "skills": { "filter": { ... } },
        "sandbox": { ... }
      }
    ]
  }
}
```

자율 에이전트도 같은 패턴: **에이전트마다 독립 워크스페이스 = 메모리/파일 격리**.

### Memory 플러그인

- `memory-core` — 기본 (파일 기반)
- `memory-lancedb` — 벡터 검색 (long-term)

vector store 어댑터 패턴 — 우리가 long-term memory에 차용 가능.

---

## 8. 호출 메타필드 — Provenance / Idempotency ★

`src/gateway/protocol/schema/agent.ts:56-94`

```typescript
const AgentParamsSchema = Type.Object({
  message: NonEmptyString,
  agentId?: NonEmptyString,
  // ...
  lane?: string,                   // 동시성 레인
  inputProvenance?: {              // 입력 출처 추적 ★
    kind: string;
    sourceSessionKey?: string;
    sourceChannel?: string;
    sourceTool?: string;
  },
  idempotencyKey: NonEmptyString,  // 멱등성 ★
  spawnedBy?: string               // 호출 체인 추적 ★
}, { additionalProperties: false });
```

### 자율 에이전트가 차용할 4가지 메타필드

| 필드 | 자율 에이전트 용도 |
|---|---|
| `idempotencyKey` | 같은 작업 재시도 시 중복 실행 방지 |
| `lane` | 동시성 제한 (예: git push는 lane=git, 직렬화) |
| `inputProvenance` | "이 작업이 어디서 왔는지" — 자기 작업인지 사용자인지 외부 트리거인지 |
| `spawnedBy` | sub-agent 호출 체인 — 디버깅과 무한 루프 방지 |

특히 `spawnedBy` + 깊이 제한은 **자율 에이전트가 자기 자신을 무한 호출하는 것**을 막는 핵심.

---

## 9. Skill 시스템 — 외부화된 능력 정의

`skills/` (54개)

### 패턴

```
skills/
├ coding-agent/SKILL.md        # 외부 자율 도구 호출
├ canvas/SKILL.md              # UI 렌더링
├ discord/SKILL.md             # 채널 연동
├ github/SKILL.md              # PR/이슈
├ himalaya/SKILL.md            # 이메일
├ model-usage/SKILL.md         # 사용량 추적
└ imsg/SKILL.md
```

### 자율 에이전트 차용

- **마크다운 + frontmatter** — 코드 없이 능력 추가
- **`requires.anyBins`** — 외부 바이너리 의존성 선언
- **사용자가 직접 추가** — 핫 리로드
- **에이전트별 필터링** (`agents.list[].skills.filter.includeByName`)

Claude Code skills + Deep Agents skills + OpenClaw skills 셋 다 같은 결론에 도달: **마크다운 frontmatter가 정답.**

---

## 10. 우리가 차용할 핵심 패턴 (정리)

### 그대로 차용

1. **ProcessSupervisor + RunRecord + scopeKey** — 장시간 작업 추적
2. **`SpawnMode: "child" | "pty"`** — 대화형 CLI 지원
3. **Docker sandbox 3-tier** (basic / common / browser)
4. **`coding-agent` 스킬 패턴** — 외부 자율 도구 호출
5. **호출 메타필드 4종** (`idempotencyKey` / `lane` / `provenance` / `spawnedBy`)
6. **워크스페이스별 격리**
7. **`TerminationReason` enum** — 정확한 종료 사유

### 강화

1. **Sandbox는 default-on** — OpenClaw는 옵션, 우리는 자율 모드에서 강제
2. **Network 격리** — sandbox에서 outbound 제한
3. **자원 한계** — CPU/memory/disk quota
4. **무한 루프 가드** — `spawnedBy` 체인 깊이 제한

### Less Relevant (skip)

- Gateway WebSocket 프로토콜 (멀티 채널용)
- Plugin SDK + Runtime 2층 (멀티 채널 봇용)
- ACP (IDE 통합용)
- 채널 도킹 (Discord/Slack/iMessage용)

---

## 11. 핵심 파일 레퍼런스

| 파일 | 무엇을 봐야 하는가 |
|---|---|
| `src/process/supervisor/types.ts` | **RunRecord, scopeKey, TerminationReason** ★ |
| `src/process/supervisor/supervisor.ts` | supervisor 구현 (라인 34-99) |
| `src/process/supervisor/adapters/child.ts` | 표준 프로세스 |
| `src/process/supervisor/adapters/pty.ts` | **PTY 모드** ★ |
| `Dockerfile.sandbox` | 최소 격리 |
| `Dockerfile.sandbox-common` | 개발 도구 |
| `Dockerfile.sandbox-browser` | GUI 자동화 |
| `skills/coding-agent/SKILL.md` | **외부 자율 에이전트 호출** ★ |
| `src/gateway/protocol/schema/agent.ts` | **호출 메타필드 4종** ★ |
| `src/agents/agent-scope.ts` | 워크스페이스 격리 |
| `docs/cli/sandbox.md` | sandbox 설정 reference |
