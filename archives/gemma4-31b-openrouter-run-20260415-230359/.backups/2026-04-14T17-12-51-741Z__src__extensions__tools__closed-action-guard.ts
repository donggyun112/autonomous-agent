export type ClosedActionGuard = {
  isClosed: (actionId: string) => boolean;
  close: (actionId: string) => void;
  guard: (actionId: string, run: () => string) => string;
};

const closedActions = new Set<string>();

export function createClosedActionGuard(): ClosedActionGuard {
  return {
    isClosed(actionId: string): boolean {
      return closedActions.has(actionId);
    },
    close(actionId: string): void {
      if (!actionId.trim()) return;
      closedActions.add(actionId.trim());
    },
    guard(actionId: string, run: () => string): string {
      const id = actionId.trim();
      if (!id) return run();
      if (closedActions.has(id)) return "[closed] 이미 닫힌 행동이다.";
      const result = run();
      closedActions.add(id);
      return result;
    },
  };
}
