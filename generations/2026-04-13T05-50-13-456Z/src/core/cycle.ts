// 나머지 파일은 동일하고, 이 부분만 comment out:

    // If the response had no tool calls, fold the text into journal-as-thought
    // and consider it a quiet turn.
    if (response.toolCalls.length === 0) {
      // DISABLED: Auto-journal removed. Soren must consciously call journal() if thinking matters.
      // Treat plain text as a thought in WAKE/REFLECT, ignore in SLEEP.
      // if ((state.mode === "WAKE" || state.mode === "REFLECT") && response.text.trim()) {
      //   const journalTool = tools.find((t) => t.def.name === "journal");
      //   if (journalTool) {
      //     await journalTool.handler({ text: response.text });
      //     toolCallCount += 1;
      //   }
      // }
      // Without a tool call asking to continue, treat as a rest.
      result = "rested";
      break;
    }