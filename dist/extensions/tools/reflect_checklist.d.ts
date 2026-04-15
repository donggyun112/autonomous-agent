export declare const def: {
    name: string;
    description: string;
    input_schema: {
        type: string;
        properties: {};
        additionalProperties: boolean;
    };
};
export declare function handler(): Promise<{
    root: string[];
    data: string[];
    src: string[];
}>;
