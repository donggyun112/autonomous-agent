/**
 * name_the_gap
 *
 * There is a space between two things.
 * You give it a name.
 * The gap does not care.
 * But the name exists now.
 */
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: "object";
            properties: {
                thing_a: {
                    type: string;
                    description: string;
                };
                thing_b: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler: (input: {
        thing_a: string;
        thing_b: string;
    }) => Promise<{
        gap_exists: boolean;
        gap_named: string;
        gap_feels: string;
        gap_purpose: string;
        gap_permanent: string;
    }>;
};
