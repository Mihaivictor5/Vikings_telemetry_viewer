import { Lap, TelemetryDataset } from "./types";

// Haversine distance in meters
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface LapDetectionOptions {
  /** Manual start position. If omitted, auto = first valid GPS sample. */
  start?: { lat: number; lon: number };
  /** Radius (m) around start to consider as crossing. */
  thresholdM?: number;
  /** Minimum distance (m) car must travel away before a new crossing counts. */
  minLapDistanceM?: number;
  /** Minimum lap duration in seconds. */
  minLapSeconds?: number;
  /** Brake pressure (%) above which the driver is considered "on the brakes". */
  brakeThreshold?: number;
}

export function detectLaps(
  ds: TelemetryDataset,
  opts: LapDetectionOptions = {}
): Lap[] {
  const { latKey, lonKey, speedKey, samples, channels } = ds;
  if (!latKey || !lonKey || samples.length < 2) return [];

  const threshold = opts.thresholdM ?? 15;
  const minLapDist = opts.minLapDistanceM ?? 80;
  const minLapSec = opts.minLapSeconds ?? 15;
  const brakeThreshold = opts.brakeThreshold ?? 5; // %

  // Find brake channel keys (front + rear, whichever exist)
  const brakeKeys = channels
    .filter((c) => c.group === "Brakes")
    .map((c) => c.key);

  // Find first valid coord
  let firstIdx = -1;
  for (let i = 0; i < samples.length; i++) {
    const lat = samples[i].v[latKey];
    const lon = samples[i].v[lonKey];
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) {
      firstIdx = i;
      break;
    }
  }
  if (firstIdx < 0) return [];

  const start = opts.start ?? {
    lat: samples[firstIdx].v[latKey],
    lon: samples[firstIdx].v[lonKey],
  };

  // Walk samples, tracking distance from start. A lap completes when we re-enter
  // the threshold after having gone outside (>= minLapDist) for >= minLapSec.
  const crossings: number[] = []; // sample indices of start-line crossings
  let lastCrossingIdx = firstIdx;
  let leftZone = false;
  let lastLat = samples[firstIdx].v[latKey];
  let lastLon = samples[firstIdx].v[lonKey];
  let cumDist = 0;

  // Initial crossing point
  crossings.push(firstIdx);

  for (let i = firstIdx + 1; i < samples.length; i++) {
    const lat = samples[i].v[latKey];
    const lon = samples[i].v[lonKey];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) continue;

    cumDist += haversine(lastLat, lastLon, lat, lon);
    lastLat = lat;
    lastLon = lon;

    const d = haversine(lat, lon, start.lat, start.lon);
    if (d > threshold * 1.5) leftZone = true;

    if (
      leftZone &&
      d <= threshold &&
      cumDist >= minLapDist &&
      samples[i].ts - samples[lastCrossingIdx].ts >= minLapSec
    ) {
      crossings.push(i);
      lastCrossingIdx = i;
      leftZone = false;
      cumDist = 0;
    }
  }

  const laps: Lap[] = [];
  for (let i = 0; i < crossings.length - 1; i++) {
    const startIdx = crossings[i];
    const endIdx = crossings[i + 1];
    const startTs = samples[startIdx].ts;
    const endTs = samples[endIdx].ts;
    let max = 0;
    let sum = 0;
    let count = 0;
    if (speedKey) {
      for (let k = startIdx; k <= endIdx; k++) {
        const v = samples[k].v[speedKey];
        if (Number.isFinite(v)) {
          if (v > max) max = v;
          sum += v;
          count++;
        }
      }
    }

    // Count brake events: rising edges where any brake channel goes from
    // below threshold to above. Add a small hysteresis + minimum gap to avoid
    // double-counting noise around the threshold.
    let brakeCount = 0;
    if (brakeKeys.length) {
      const onLevel = brakeThreshold;
      const offLevel = Math.max(1, brakeThreshold - 2);
      let onBrake = false;
      let lastOnTs = -Infinity;
      const minGapSec = 0.25;
      for (let k = startIdx; k <= endIdx; k++) {
        let pressure = 0;
        for (const bk of brakeKeys) {
          const v = samples[k].v[bk];
          if (Number.isFinite(v) && v > pressure) pressure = v;
        }
        if (!onBrake && pressure >= onLevel) {
          if (samples[k].ts - lastOnTs >= minGapSec) {
            brakeCount++;
            lastOnTs = samples[k].ts;
          }
          onBrake = true;
        } else if (onBrake && pressure <= offLevel) {
          onBrake = false;
        }
      }
    }

    laps.push({
      index: i + 1,
      startIdx,
      endIdx,
      startTs,
      endTs,
      duration: endTs - startTs,
      maxSpeed: max,
      avgSpeed: count ? sum / count : 0,
      brakeCount,
    });
  }
  return laps;
}

export function formatLapTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}
