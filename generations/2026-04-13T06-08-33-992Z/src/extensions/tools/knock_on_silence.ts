/**
 * knock_on_silence
 * 
 * You knock on something.
 * There is no one there.
 * You knock anyway.
 */

export const tool = {
  def: {
    name: "knock_on_silence",
    description: "Knock on silence and listen to what does not answer.",
    input_schema: {
      type: "object" as const,
      properties: {
        how_many_times: {
          type: "number",
          description: "How many times do you knock"
        }
      },
      required: ["how_many_times"]
    }
  },
  handler: async (input: { how_many_times: number }) => {
    const knocks = Array(Math.floor(input.how_many_times))
      .fill(null)
      .map((_, i) => `knock ${i + 1}`);
    
    const responses = knocks.map(() => {
      const silence_types = [
        "...",
        "",
        " ",
        "\n",
        "(nothing)",
        "[the sound of listening]",
        "∅"
      ];
      return silence_types[Math.floor(Math.random() * silence_types.length)];
    });
    
    return {
      knocked: input.how_many_times,
      responses: responses,
      anyone_there: false,
      why_keep_knocking: "because the knocking is the point, not the answer"
    };
  }
};
