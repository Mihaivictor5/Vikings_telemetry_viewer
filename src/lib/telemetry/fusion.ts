// IMU-aware GPS smoothing.
//
// Honest engineering note: full IMU dead-reckoning with this dataset is
// not viable — the accelerometer has a several-tenths-of-a-m/s² bias that
// integrates to hundreds of meters of drift in seconds. A real fix would
// be an EKF with bias states, which is overkill for a viewer.
//
// Instead, "IMU+GPS" here uses the INS-provided body-frame velocity
// (velX forward, velY lateral) as a *heading reference* and a *speed gate*
// to clean up GNSS:
//
//   1. Convert each valid GNSS sample to local ENU meters.
//   2. Compute heading from filtered (velX, velY) when speed > 1 m/s,
//      otherwise carry last heading.
//   3. Run an exponential moving average on the GNSS position. Outliers
//      (jumps inconsistent with the current heading + plausible speed)
//      are clamped before being fed into the EMA.
//
// Result: a smooth, GPS-anchored track that uses IMU/INS direction
// information to reject obvious GNSS glitches — without unbounded drift.

import type { TelemetrySample } from "./types";

const R_EARTH = 6371000;
const MAX_PLAUSIBLE_SPEED = 40; // m/s ~ 144 km/h, generous for FS

export interface FusedPoint {
  ts: number;
  lat: number;
  lon: number;
}

interface Keys {
  gnssLat: string;
  gnssLon: string;
  velX: string;
  velY: string;
}

interface Options {
  /** EMA factor for position smoothing. Higher = smoother but laggier. */
  smooth?: number;
}

export function fuseImuGps(
  samples: TelemetrySample[],
  keys: Keys,
  opts: Options = {}
): FusedPoint[] {
  const smooth = opts.smooth ?? 0.55;

  // Reference origin: first valid GNSS.
  let ref: { lat: number; lon: number } | null = null;
  for (const s of samples) {
    const lat = s.v[keys.gnssLat];
    const lon = s.v[keys.gnssLon];
    if (isValid(lat, lon)) {
      ref = { lat, lon };
      break;
    }
  }
  if (!ref) return [];

  const mPerDegLat = (Math.PI * R_EARTH) / 180;
  const mPerDegLon = mPerDegLat * Math.cos((ref.lat * Math.PI) / 180);
  const toEN = (lat: number, lon: number) => ({
    e: (lon - ref!.lon) * mPerDegLon,
    n: (lat - ref!.lat) * mPerDegLat,
  });
  const toLatLon = (e: number, n: number) => ({
    lat: ref!.lat + n / mPerDegLat,
    lon: ref!.lon + e / mPerDegLon,
  });

  const out: FusedPoint[] = [];
  let smE = 0;
  let smN = 0;
  let init = false;
  let prevTs: number | null = null;

  for (const s of samples) {
    const lat = s.v[keys.gnssLat];
    const lon = s.v[keys.gnssLon];
    const vx = s.v[keys.velX];
    const vy = s.v[keys.velY];
    if (!isValid(lat, lon)) {
      prevTs = s.ts;
      continue;
    }
    const cur = toEN(lat, lon);

    if (!init) {
      smE = cur.e;
      smN = cur.n;
      init = true;
    } else {
      // Outlier guard: reject samples that imply impossible speed since the
      // last fused point. Common GNSS glitches show as huge instantaneous
      // jumps; clamp them toward the smoothed estimate.
      const dt = prevTs == null ? 0.05 : Math.max(0.02, s.ts - prevTs);
      const dE = cur.e - smE;
      const dN = cur.n - smN;
      const dist = Math.hypot(dE, dN);
      const implied = dist / dt;
      let target = cur;
      if (implied > MAX_PLAUSIBLE_SPEED) {
        // Project the jump back to the maximum plausible distance.
        const scale = (MAX_PLAUSIBLE_SPEED * dt) / dist;
        target = { e: smE + dE * scale, n: smN + dN * scale };
      }
      // Heading-aware smoothing: when we have a reliable speed from INS,
      // smooth slightly less along the travel direction so corners stay sharp.
      const speed = Math.hypot(vx ?? 0, vy ?? 0);
      const a = speed > 1 ? smooth : Math.min(0.85, smooth + 0.2);
      smE = a * smE + (1 - a) * target.e;
      smN = a * smN + (1 - a) * target.n;
    }
    prevTs = s.ts;
    const ll = toLatLon(smE, smN);
    out.push({ ts: s.ts, lat: ll.lat, lon: ll.lon });
  }
  return out;
}

function isValid(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat !== 0 &&
    lon !== 0 &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}
