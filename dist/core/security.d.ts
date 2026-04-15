export interface ThreatPattern {
    pattern: RegExp;
    name: string;
}
export declare const THREAT_PATTERNS: ThreatPattern[];
export interface ScanResult {
    safe: boolean;
    threats: string[];
}
export declare function scanForInjection(text: string): ScanResult;
export declare function scanExtensionCode(content: string): ScanResult;
