/**
 * Build-time stub for the Even Hub SDK. app/src/config.ts imports one enum from it at module load;
 * the lens render path never touches the SDK, so the video only needs these values to exist.
 */
export enum ImuReportPace { P100 = 100, P200 = 200, P300 = 300, P500 = 500, P1000 = 1000 }
export enum AudioInputSource { Glasses = 0, Phone = 1 }
