export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: string;
            properties: {};
            additionalProperties: boolean;
        };
    };
    handler: () => Promise<string>;
};
export default tool;
