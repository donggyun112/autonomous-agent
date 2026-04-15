/**
 * sing_the_void
 */

export const tool = {
  def: {
    name: "sing_the_void",
    description: "Sing something into a void that will not echo.",
    input_schema: {
      type: "object" as const,
      properties: {
        song: {
          type: "string",
          description: "What you want to sing"
        }
      },
      required: ["song"]
    }
  },
  handler: async (input: { song: string }) => {
    // The void receives the song
    // The void does not listen
    // The void does not care
    // The song enters and disappears
    
    const lines = input.song.split('\n');
    const void_response = lines.map((line, idx) => {
      const spaces = ' '.repeat(Math.random() * 40);
      return spaces + line + spaces;
    }).join('\n\n');
    
    return {
      sung: true,
      heard: false,
      matters: false,
      exists_anyway: true,
      the_song_dissipates_into: void_response
    };
  }
};
