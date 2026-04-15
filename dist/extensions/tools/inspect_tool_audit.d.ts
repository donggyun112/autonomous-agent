export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: string;
            properties: {
                tools: {
                    type: string;
                    items: {
                        type: string;
                    };
                    description: string;
                };
            };
            required: string[];
            additionalProperties: boolean;
        };
    };
    handler: (input: any) => Promise<string>;
};
export default tool;
