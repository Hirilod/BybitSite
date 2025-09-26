export declare const BYBIT_API_BASE = "https://api.bybit.com";
export declare const TIMEFRAME_CONFIG: readonly [{
    readonly id: "M1";
    readonly label: "M1";
    readonly interval: "1";
    readonly durationMs: number;
}, {
    readonly id: "M5";
    readonly label: "M5";
    readonly interval: "5";
    readonly durationMs: number;
}, {
    readonly id: "M15";
    readonly label: "M15";
    readonly interval: "15";
    readonly durationMs: number;
}, {
    readonly id: "M30";
    readonly label: "M30";
    readonly interval: "30";
    readonly durationMs: number;
}, {
    readonly id: "H1";
    readonly label: "H1";
    readonly interval: "60";
    readonly durationMs: number;
}, {
    readonly id: "H4";
    readonly label: "H4";
    readonly interval: "240";
    readonly durationMs: number;
}, {
    readonly id: "D1";
    readonly label: "D1";
    readonly interval: "D";
    readonly durationMs: number;
}];
export type TimeframeId = typeof TIMEFRAME_CONFIG[number]['id'];
//# sourceMappingURL=constants.d.ts.map