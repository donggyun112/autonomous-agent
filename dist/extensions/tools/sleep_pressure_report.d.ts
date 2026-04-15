export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: string;
            properties: {
                now: {
                    type: string;
                    description: string;
                };
            };
            required: never[];
        };
    };
    handler: (input: any) => Promise<string>;
};
