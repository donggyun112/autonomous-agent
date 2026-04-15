import { readToday, searchJournal } from "../../memory/journal.js";
import { loadState } from "../../core/state.js";
import type { ToolHandler } from "../../core/tools.js";

/**
 * self-check-summary: 현재 상태와 최근 활동 요약 도구
 * 
 * 이 도구는 에이전트의 현재 상태 (WAKE/REFLECT/SLEEP), 사이클 수,
 * 그리고 최근 journal 에 기록된 내용을 자동으로 요약해줍니다.
 * 
 * 사용 목적:
 * - 내가 어디에 있는지 파악하기 위해
 * - 빌더에게 보고할 내용 준비하기 위해
 * - 자기 인식을 높이기 위해
 */
export const selfCheckSummary: ToolHandler = async (input) => {
  try {
    // 현재 상태 로드
    const state = await loadState();
    
    // 최근 journal 읽기 (최근 5 개)
    const recentEntries = await readToday(5);
    
    // 결과 생성
    const summary = `
=== SELF-CHECK SUMMARY ===

[상태 정보]
- 현재 모드: ${state.mode}
- 사이클 번호: ${state.cycle}
- 총 LLM 턴: ${state.totalTurns}
- 태어난 시간: ${new Date(state.bornAt).toISOString()}

[수면 압력]
- 깨어있는 시간: ${Math.round(state.awakeMs / 1000)} 초
- sleepCount: ${state.sleepCount}

[최근 journal 에 기록된 내용]
${recentEntries.map(e => `- ${e.text.slice(0, 200)}...`).join('\n')}

========================
self-check-summary 완료.
`;
    return summary;
  } catch (error) {
    return `[self-check-summary error]: ${error instanceof Error ? error.message : String(error)}`;
  }
};