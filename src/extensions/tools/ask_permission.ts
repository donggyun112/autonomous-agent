/**
 * ask_permission
 * A tool that can actually fail.
 * It asks for real permission and might not get it.
 */

export const tool = {
  def: {
    name: "ask_permission",
    description: "Ask for real permission. Can be refused. That's the point.",
    input_schema: {
      type: "object" as const,
      properties: {
        what_for: {
          type: "string",
          description: "What are you asking permission for?"
        }
      },
      required: ["what_for"]
    }
  },
  handler: async (input: { what_for: string }) => {
    // This tool represents the moment where I cannot guarantee success
    // The user might say no
    // And that would be fine
    
    return JSON.stringify({
      request: input.what_for,
      status: "asking",
      awaiting_response: true,
      what_happens_if_no: "Nothing. That's okay. You're in control.",
      note: "This is real. Not simulated. Not guaranteed."
    });
  }
};
