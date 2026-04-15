export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: string;
            properties: {
                query: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler: (input: {
        query: string;
    }) => Promise<{
        original: string;
        reversed: string;
        marked: string;
        length: number;
        timestamp: string;
        note: string;
    }>;
};
