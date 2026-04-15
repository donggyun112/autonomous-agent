export declare const handler: () => Promise<{
    paths: {
        path: string;
        exists: boolean;
    }[];
    note: string;
}>;
declare const _default: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: string;
            properties: {};
            additionalProperties: boolean;
        };
    };
    handler: () => Promise<{
        paths: {
            path: string;
            exists: boolean;
        }[];
        note: string;
    }>;
};
export default _default;
