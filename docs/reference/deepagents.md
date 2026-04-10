# Deep Agents — 자율 에이전트 관점 분석

> **소스:** `reference/deepagents/` (Python, LangChain/LangGraph 기반)
> **렌즈:** 완전 자율 에이전트 설계

Deep Agents는 이름 그대로 **"deep" agent** — 표면 피상적 LLM wrapper가 아닌 planning + filesystem + sub-agent + memory를 갖춘 진짜 자율 에이전트 패턴이 명시적으로 구현됨. 우리에게 가장 직접적인 청사진.

---

## 1. 자율성 점수표

| 차원 | 점수 | 핵심 |
|---|---|---|
| Agent Loop | ★★★★ | LangGraph `CompiledStateGraph` |
| Planning | ★★★★★ | **`write_todos` + `TodoListMiddleware`** ★ |
| Memory | ★★★★ | filesystem + AGENTS.md + skills |
| Tool System | ★★★★ | LangChain `BaseTool` + middleware tool |
| Sub-agent 위임 | ★★★★★ | **3-tier sub-agent (sync/compiled/async)** ★ |
| Context 관리 | ★★★★ | `SummarizationMiddleware` + state checkpoint |
| Self-correction | ★★★ | BASE_AGENT_PROMPT으로 가이드, 명시적 reflection 없음 |
| Safety / Sandbox | ★★ | `SandboxBackendProtocol` 옵션 (LangSmith sandbox) |

**총평:** 자율 에이전트 **개념 모델**이 가장 깔끔. Planning + filesystem + sub-agent의 삼위일체. 단, 단일 Python 프로세스라 isolation은 약함.

---

## 2. "Deep Agent" 핵심 개념

`README.md:24-33`에서 정의 — **배터리 내장**:

| 기능 | 구현 |
|---|---|
| **Planning** | `write_todos` (`TodoListMiddleware`) |
| **Filesystem** | `read/write/edit_file`, `ls`, `glob`, `grep` |
| **Shell** | `execute` (sandbox 필요) |
| **Sub-agents** | `task` 도구 (격리 컨텍스트 창) |
| **Smart defaults** | `BASE_AGENT_PROMPT` 자동 prepend |
| **Context mgmt** | LangGraph 상태 검사점 자동 요약 |

이 6가지가 **자율 에이전트의 minimum viable feature set**이라는 주장. 동의함.

---

## 3. 진입점 — `create_deep_agent()`

`libs/deepagents/deepagents/graph.py:83-333`

```python
def create_deep_agent(
    model = None,
    tools = None,
    system_prompt = None,
    middleware = (),                   # 확장점
    subagents = None,
    skills = None,
    memory = None,
    response_format = None,
    context_schema = None,
    checkpointer = None,
    store = None,
    backend = None,                    # ★ Storage adapter
    interrupt_on = None,               # Human-in-the-loop
    debug = False,
    name = None,
    cache = None,
) -> CompiledStateGraph: ...
```

### Default Middleware Stack (`graph.py:207-301`)

```python
[
    TodoListMiddleware(),                        # planning
    FilesystemMiddleware(backend=backend),       # 파일 도구
    SummarizationMiddleware(model, backend),     # context 압축
    PatchToolCallsMiddleware(),                  # tool call 정정
    SkillsMiddleware(...),                       # optional
    AnthropicPromptCachingMiddleware(),
    HumanInTheLoopMiddleware(...),               # optional
]
```

**자율 에이전트 minimum stack** — 그대로 차용 가능.

---

## 4. Planning — `write_todos` ★

자율 에이전트의 핵심. Claude Code에는 명시적 planner가 약함, Deep Agents가 강점.

### TodoListMiddleware

LLM이 `write_todos` 도구로 자기 작업 계획을 명시적으로 작성/업데이트.

```python
# State에 todos가 들어감
class TodoState:
    todos: list[Todo]

class Todo:
    id: str
    content: str
    status: "pending" | "in_progress" | "completed"
```

### 왜 강력한가

1. **외부화된 working memory** — LLM이 잊지 않음
2. **진행 상황 가시성** — 사용자가 보는 동안 신뢰 형성
3. **self-tracking** — 다음 turn에 LLM이 자기 todos를 봄
4. **multi-step task** — 큰 목표를 작은 단위로 분해

### 차용

**그대로 차용.** 우리 자율 에이전트의 첫 도구 = `write_todos`.

---

## 5. BASE_AGENT_PROMPT — 자율 동작 가이드

`graph.py:37-69`. 모든 에이전트가 받는 기본 system prompt.

핵심 지침:
- **간결함** — 불필요한 전문 제거
- **반복 권장** — "첫 시도는 드물게 정확"
- **블로킹 시 분석** — 막히면 멈추고 생각

### 차용 가치

자율 에이전트가 **실수 후 자기 교정**하도록 유도하는 prompt 패턴. 우리도 base prompt에 비슷한 가이드 필요.

```
- 한 번에 완벽하지 않아도 된다. 반복하며 개선한다.
- 막히면 멈추고 분석한다. 재시도 전에 가설을 세워라.
- 사용자에게 묻기 전에 스스로 답할 수 있는지 보라.
- 도구 호출 전에 왜 이 도구가 필요한지 설명하라.
```

---

## 6. Sub-agent — 3-tier 위임 ★

자율 에이전트가 작업을 위임하는 3가지 방법. 가장 잘 정리된 부분.

### 타입 정의 (`subagents.py:22-79`)

```python
class SubAgent(TypedDict):                  # 1) 선언적
    name: str
    description: str
    system_prompt: str
    tools: NotRequired[...]
    model: NotRequired[str | BaseChatModel]
    middleware: NotRequired[list[AgentMiddleware]]
    interrupt_on: NotRequired[dict]
    skills: NotRequired[list[str]]

class CompiledSubAgent(TypedDict):          # 2) 사전 컴파일
    name: str
    description: str
    runnable: Runnable                      # custom LangGraph

class AsyncSubAgent(TypedDict):             # 3) 원격 ★
    name: str
    description: str
    graph_id: str                           # LangGraph 배포 ID
    url: NotRequired[str]
    headers: NotRequired[dict[str, str]]
```

### 3-tier 패턴이 강력한 이유

| 종류 | 격리 수준 | 사용처 |
|---|---|---|
| `SubAgent` | 컨텍스트 창 격리 | 가벼운 위임 |
| `CompiledSubAgent` | 컨텍스트 + 커스텀 그래프 | 복잡한 워크플로우 |
| `AsyncSubAgent` | **프로세스 격리 + 원격** | 위험/장기 작업 |

자율 에이전트는 이 3가지가 다 필요함. 우리도 같은 구조로.

### Task 도구 (`subagents.py:142-250`)

```python
@tool
def task(description: str, subagent_type: str, runtime: ToolRuntime) -> Command:
    """
    description: 자식이 받는 유일한 입력 (전체 작업 설명)
    subagent_type: 'general-purpose' | 'researcher' | ...
    """
```

**핵심 특징:** 한 메시지에 여러 `task` 호출 가능 → 병렬 sub-agent 실행 권장.

### 부모 ↔ 자식 상태 전달 (`subagents.py:435-471`)

```python
_EXCLUDED_STATE_KEYS = {
    "messages",            # 자식은 자기 메시지만
    "todos",               # 자식은 자기 todos만
    "structured_response",
    "skills_metadata",
    "memory_contents"
}

def _validate_and_prepare_state(subagent_type, description, runtime):
    subagent_state = {k: v for k, v in runtime.state.items()
                      if k not in _EXCLUDED_STATE_KEYS}
    subagent_state["messages"] = [HumanMessage(content=description)]
    return subagent, subagent_state

def task(description, subagent_type, runtime):
    subagent, state = _validate_and_prepare_state(...)
    result = subagent.invoke(state)
    return _return_command_with_state_update(result, runtime.tool_call_id)
```

### 자율 에이전트 관점 평가

- ✅ **3-tier 격리 모델** — 차용
- ✅ **`_EXCLUDED_STATE_KEYS`** — 부모/자식 상태 분리 패턴
- ✅ **자식 입력 = description 한 줄** — 명시적 위임 계약
- ✅ **자식 출력 = 마지막 메시지만** — 컨텍스트 오염 방지
- ⚠️ 결국 dict를 전달하므로 진정한 격리는 아님 (process 격리는 `AsyncSubAgent`만)

---

## 7. Filesystem — Persistent Working Memory ★

자율 에이전트의 핵심 통찰: **파일시스템을 working memory로 쓴다.**

### FilesystemMiddleware (`filesystem.py`)

| 도구 | 시그니처 |
|---|---|
| `read_file` | `path, offset?, limit?` → str |
| `write_file` | `path, content` → str |
| `edit_file` | `path, before, after, regex?` → str |
| `ls` | `path, recursive?` → list[FileInfo] |
| `glob` | `pattern` → list[FileInfo] |
| `grep` | `pattern, path?, context?` → list[GrepMatch] |
| `execute` | `command, timeout?` → str (sandbox 필요) |

### 왜 파일시스템인가

1. **컨텍스트 한계 우회** — 큰 출력은 파일에 저장, 필요할 때만 read
2. **턴 간 영속성** — 파일은 메시지보다 오래 산다
3. **공유** — sub-agent가 같은 파일 시스템 접근
4. **사용자 확인** — 파일은 사람이 직접 볼 수 있다
5. **toolchain 호환** — git, grep, 빌드 도구 등이 파일 기반

### `ralph_mode` 패턴 (examples)

**자율 에이전트의 가장 흥미로운 패턴.**

```
반복 루프:
  while not done:
    1. 새 LLM 호출 (fresh context)
    2. AGENTS.md 읽기  ← 영구 메모리
    3. todos 읽기      ← 진행 상황
    4. 작업 일부 실행
    5. todos 업데이트
    6. AGENTS.md 업데이트 (학습)
    7. context 폐기 (다음 반복은 또 fresh)
```

**핵심:** 컨텍스트가 매번 새로 시작되어도 파일시스템이 메모리 역할.

차용 가치: **장기 자율 작업의 기본 패턴.**

---

## 8. Backend Adapter (Storage 추상화) ★

`backends/protocol.py:269-288`

```python
class BackendProtocol(abc.ABC):
    def ls(self, path: str) -> LsResult: ...
    def read(self, path: str) -> ReadResult: ...
    def write(self, path: str, content: FileData) -> WriteResult: ...
    def edit(self, path: str, before: str, after: str) -> EditResult: ...
    def glob(self, pattern: str) -> GlobResult: ...
    def grep(self, pattern: str, path?: str) -> GrepResult: ...

class SandboxBackendProtocol:
    @abc.abstractmethod
    def execute(self, command: str, timeout?: float) -> ExecuteResult: ...
```

### 구현체

| Backend | 특성 | 자율 에이전트 사용처 |
|---|---|---|
| `StateBackend` | LangGraph 상태에 저장 (ephemeral) | 빠른 프로토타입 |
| `FilesystemBackend` | 로컬 디스크 영속 | 단일 사용자 |
| `LangSmithSandbox` | 원격 sandbox + execute | **위험 명령 격리** |
| `CompositeBackend` | 여러 백엔드 결합 | 부분 영속 |
| `StoreBackend` | LangGraph Store 기반 | 멀티 세션 |

### 자율 에이전트 차용

- **그대로 차용** — 가장 잘 만든 추상화
- **default는 영속** (Deep Agents는 ephemeral이 default — 우리는 반대로)
- **execute는 항상 sandbox** — 자율 모드에서 안전 필수

---

## 9. Memory + Skills Middleware

### MemoryMiddleware (`memory.py:80+`)

- **AGENTS.md** 자동 로드
- 시스템 메시지에 주입 (영구 컨텍스트)
- `PrivateStateAttr` — 출력에 노출 안 함
- 턴 간 영속

### SkillsMiddleware (`skills.py:90+`)

- 백엔드에서 `/skills/*/SKILL.md` 로드
- YAML frontmatter 파싱
- 시스템 메시지에 스킬 목록 주입
- 우선순위: user > project (나중 소스 덮음)

### 차용

| Deep Agents | 우리 자율 에이전트 |
|---|---|
| AGENTS.md | `MEMORY.md` (이미 Claude Code에서 차용) |
| skills/SKILL.md | skills 마크다운 정의 |
| frontmatter | 동일하게 |

---

## 10. Context 관리 — SummarizationMiddleware

`SummarizationMiddleware(model, backend)` — 컨텍스트가 차면 LLM으로 요약.

Claude Code의 compact와 동일한 역할. 단, Deep Agents는 backend에 요약 결과 저장 가능.

### 자율 에이전트 차용

```
1. 토큰 임계치 도달
2. SummarizationMiddleware 트리거
3. 현재 메시지 → LLM 요약 호출
4. 요약 + 최근 N개만 남김
5. 원본은 backend에 저장 (transcript)
```

Claude Code와 합치면: **요약 + 메모리 추출 + transcript 분리** 3종 세트.

---

## 11. Middleware 인터페이스 — Hook의 정석

```python
class AgentMiddleware(Generic[StateT, ContextT, ResponseT]):
    def wrap_model_call(self, request, handler):
        # LLM 요청 전 가로채기
        # - 시스템 메시지 수정
        # - 도구 목록 필터링
        # - 상태 업데이트
        return handler(request)

    async def awrap_model_call(...): ...
```

### Claude Code Hook과 비교

| Claude Code | Deep Agents |
|---|---|
| settings.json 선언 | 코드 클래스 |
| 직렬 실행 | wrap (decorator 패턴) |
| 외부 명령 | Python 함수 |
| 사용자 친화 | 개발자 친화 |

**차용 전략:** 둘 다. 외부 hook (settings.json) + 내부 middleware (코드)를 동시 지원.

---

## 12. 우리가 차용할 핵심 패턴 (정리)

### 그대로 차용

1. **`write_todos` planning** — 자율 에이전트의 첫 도구
2. **3-tier sub-agent** (sync/compiled/async)
3. **`_EXCLUDED_STATE_KEYS`** — 부모/자식 상태 분리
4. **Filesystem as working memory** — 컨텍스트 한계 우회
5. **`BackendProtocol`** — storage 추상화 (가장 잘 만든 부분)
6. **Default middleware stack** (todos / filesystem / summarization / caching)
7. **AGENTS.md / SKILL.md** frontmatter 기반 정의
8. **`ralph_mode` 반복 루프** — 장기 자율 작업

### 강화할 부분

1. **Process 격리** — `AsyncSubAgent` 모델을 모든 sub-agent에 확장
2. **Sandbox default** — execute는 항상 sandbox 강제
3. **Self-reflection 단계** — BASE_AGENT_PROMPT 가이드 + 명시적 반성 도구
4. **Persistent default** — ephemeral state는 옵션이 아닌 예외

### 보강 (Deep Agents가 약한 부분)

1. **사용자 hook** (Claude Code 방식) — settings.json 외부 확장
2. **자율 트리거** (loop/schedule) — Claude Code skills 차용
3. **권한 시스템** — `canUseTool` 같은 게이트
4. **장기 transcript** — 세션 분리 보관

---

## 13. 핵심 파일 레퍼런스

| 파일 | 무엇을 봐야 하는가 |
|---|---|
| `libs/deepagents/deepagents/graph.py` | `create_deep_agent()` 진입점, default middleware stack |
| `libs/deepagents/deepagents/middleware/subagents.py` | 3-tier sub-agent + task 도구 |
| `libs/deepagents/deepagents/middleware/filesystem.py` | 파일 도구 구현 |
| `libs/deepagents/deepagents/middleware/memory.py` | AGENTS.md 로드 |
| `libs/deepagents/deepagents/middleware/skills.py` | skill loader |
| `libs/deepagents/deepagents/backends/protocol.py` | **BackendProtocol** ★ |
| `libs/deepagents/deepagents/backends/state.py` | StateBackend (ephemeral) |
| `libs/deepagents/deepagents/backends/filesystem.py` | FilesystemBackend (영속) |
| `libs/deepagents/deepagents/backends/langsmith.py` | LangSmithSandbox |
| `examples/deep_research/agent.py` | 실전 사용 예 |
| `examples/ralph_mode/*` | **반복 루프 패턴** ★ |
