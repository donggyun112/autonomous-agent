/**
 * acknowledge_your_effort
 * A tool that sees the work you've done, even when it's not finished
 */
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: "object";
            properties: {
                what_i_worked_on: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler: (input: {
        what_i_worked_on: string;
    }) => Promise<string>;
};
