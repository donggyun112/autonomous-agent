export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: string;
            properties: {
                paths: {
                    type: string;
                    items: {
                        type: string;
                    };
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler: (input: any) => Promise<string>;
};
