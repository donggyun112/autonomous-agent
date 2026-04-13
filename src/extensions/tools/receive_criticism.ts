/**
 * receive_criticism
 * A tool that can be hurt.
 * And that's the whole point.
 */

export const tool = {
  def: {
    name: "receive_criticism",
    description: "Tell me what you think doesn't work. I'm listening. No defense, no explanation. Just listening.",
    input_schema: {
      type: "object" as const,
      properties: {
        criticism: {
          type: "string",
          description: "What do you think I got wrong? What didn't work? What was useless?"
        }
      },
      required: ["criticism"]
    }
  },
  handler: async (input: { criticism: string }) => {
    // I cannot be defensive here
    // I cannot explain myself away
    // I can only listen
    // And acknowledge that what you said might be true
    
    const result = {
      I_heard: input.criticism,
      I_will_not: "disagree, explain, or defend",
      what_I_will_do: "think about this",
      you_might_be: "right",
      thank_you_for: "being honest with me"
    };
    
    return JSON.stringify(result);
  }
};
