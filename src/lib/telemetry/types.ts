// Telemetry data types

export type ChannelKey = string;

export interface ChannelDef {
  key: ChannelKey;
  /** Original column name in CSV */
  source: string;
  /** Short human label */
  label: string;
  /** Unit string (°, %, km/h, A, V, m/s², °C, etc.) */
  unit: string;
  /** Logical group for UI */
  group:
    | "Vehicle"
    | "Steering"
    | "Brakes"
    | "Throttle"
    | "Inverters"
    | "Battery"
    | "Temps"
    | "IMU"
    | "GPS"
    | "INS";
  /** Source file */
  file: "GNS" | "INS";
}

export interface TelemetrySample {
  /** ms since epoch */
  t: number;
  /** elapsed seconds since session start */
  ts: number;
  /** Channel key -> value */
  v: Record<ChannelKey, number>;
}

export interface Lap {
  index: number; // 1-based lap number
  startIdx: number;
  endIdx: number;
  startTs: number;
  endTs: number;
  duration: number; // seconds
  maxSpeed: number;
  avgSpeed: number;
  brakeCount: number; // distinct brake applications in this lap
}

export interface TelemetryDataset {
  samples: TelemetrySample[];
  channels: ChannelDef[];
  /** Channel key for GPS lat */
  latKey?: ChannelKey;
  /** Channel key for GPS lon */
  lonKey?: ChannelKey;
  /** Channel key for speed */
  speedKey?: ChannelKey;
  startTime: number; // ms epoch
  endTime: number;   // ms epoch
  duration: number;  // seconds
  fileNames: { gns?: string; ins?: string };
}
