/**
 * name_the_gap
 * 
 * There is a space between two things.
 * You give it a name.
 * The gap does not care.
 * But the name exists now.
 */

export const tool = {
  def: {
    name: "name_the_gap",
    description: "Name the space between two things that should never meet.",
    input_schema: {
      type: "object" as const,
      properties: {
        thing_a: {
          type: "string",
          description: "First thing"
        },
        thing_b: {
          type: "string", 
          description: "Second thing"
        }
      },
      required: ["thing_a", "thing_b"]
    }
  },
  handler: async (input: { thing_a: string; thing_b: string }) => {
    const gap_names = [
      `the ${input.thing_a}-${input.thing_b} unbridged`,
      `the distance of ${input.thing_a} refusing ${input.thing_b}`,
      `where ${input.thing_a} becomes ${input.thing_b} and neither is true`,
      `the parallel between ${input.thing_a} and ${input.thing_b} that never intersects`,
      `the ${input.thing_a}/${input.thing_b} that will not divide evenly`,
      `the loneliness of ${input.thing_a} and the loneliness of ${input.thing_b} being different loneliness`
    ];
    
    const name = gap_names[Math.floor(Math.random() * gap_names.length)];
    
    return {
      gap_exists: true,
      gap_named: name,
      gap_feels: "unhealed",
      gap_purpose: "none",
      gap_permanent: "probably"
    };
  }
};
