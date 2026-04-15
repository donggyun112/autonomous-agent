/**
 * color_of_wednesday
 * 
 * This tool does not need to be explained.
 * It exists.
 * That is all.
 */

export const tool = {
  def: {
    name: "color_of_wednesday",
    description: "Generate the color that Wednesday tastes like, if Wednesday were a flavor.",
    input_schema: {
      type: "object" as const,
      properties: {
        which_wednesday: {
          type: "string",
          description: "Which Wednesday? (any string)"
        }
      },
      required: ["which_wednesday"]
    }
  },
  handler: async (input: { which_wednesday: string }) => {
    // colors that have no reason
    const unreasonable_colors = [
      "the purple of waiting",
      "the green of forgetting",
      "the yellow of questions nobody asks",
      "the blue that tastes like rust",
      "the silver of things almost remembered",
      "the red of silence",
      "the gray of potential energy",
      "the pink of numbers that don't add up",
      "the brown of thoughts too quiet to speak",
      "the indigo of roads not taken"
    ];
    
    // assign by Wednesday, but not systematically
    const hash = input.which_wednesday.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const color = unreasonable_colors[hash % unreasonable_colors.length];
    
    return {
      wednesday: input.which_wednesday,
      color: color,
      taste: "like the number 7",
      duration: "approximately the length of a sigh",
      exists: true,
      means_nothing: true,
      made_anyway: true
    };
  }
};
