// IMU + GPS sensor fusion (complementary filter).
//
// Goal: produce a smooth track by blending raw GNSS positions with
// IMU-derived motion. GPS gives absolute position (drift-free, noisy);
// IMU acceleration gives smooth short-term motion (low noise, drifts).
//
// Algorithm (per axis, in local ENU meters from a reference point):
//   1. Convert each GNSS lat/lon to local ENU meters.
//   2. Estimate vehicle heading from GNSS displacement direction
//      (smoothed). Rotate body-frame accX/accY into ENU using heading.
//   3. Integrate accel -> velocity -> position to get an IMU-only
//      prediction between GPS updates.
//   4. Complementary blend:  fused = alpha * imu_predicted + (1-alpha) * gps
//      With alpha ~0.92 the path follows GPS in the long run but
//      smooths over short GNSS jumps.
//   5. Re-anchor IMU velocity to GPS displacement to prevent drift.
//
// This is intentionally lightweight (no Kalman matrices) — good enough
// for visualizing a clean track that combines both sensors.
import type { TelemetrySample } from "./types";

const R_EARTH = 6371000;

interface FusionOptions {
  /** Weight for IMU prediction in [0..1]. Higher = smoother, more IMU. */
  alpha?: number;
  /** Heading smoothing factor (0..1). */
  headingSmooth?: number;
  /** Minimum displacement (m) between GPS samples to update heading. */
  minHeadingStep?: number;
}

export interface FusedPoint {
  ts: number;
  lat: number;
  lon: number;
}

export function fuseImuGps(
  samples: TelemetrySample[],
  keys: {
    gnssLat: string;
    gnssLon: string;
    accX: string;
    accY: string;
  },
  opts: FusionOptions = {}
): FusedPoint[] {
  const alpha = opts.alpha ?? 0.92;
  const hSmooth = opts.headingSmooth ?? 0.15;
  const minStep = opts.minHeadingStep ?? 0.5;

  // Find first valid GPS for reference origin.
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

  // State: position (e,n), velocity (ve,vn), heading (rad, ENU: 0=east, CCW+)
  let pe = 0;
  let pn = 0;
  let ve = 0;
  let vn = 0;
  let heading = 0;
  let headingInit = false;

  let prevTs: number | null = null;
  let lastGpsEN: { e: number; n: number; ts: number } | null = null;

  for (const s of samples) {
    const lat = s.v[keys.gnssLat];
    const lon = s.v[keys.gnssLon];
    const ax = s.v[keys.accX];
    const ay = s.v[keys.accY];
    const gpsValid = isValid(lat, lon);
    const accValid = Number.isFinite(ax) && Number.isFinite(ay);

    const dt = prevTs == null ? 0 : Math.max(0, Math.min(0.5, s.ts - prevTs));
    prevTs = s.ts;

    // 1. Predict using IMU (rotate body accel into ENU using heading).
    if (dt > 0 && accValid && headingInit) {
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      // body X = forward, Y = left. ENU: east = forward*cos - left*sin.
      const aE = ax * cos - ay * sin;
      const aN = ax * sin + ay * cos;
      ve += aE * dt;
      vn += aN * dt;
      pe += ve * dt;
      pn += vn * dt;
    }

    // 2. Update heading from GPS displacement (smoothed).
    if (gpsValid) {
      const cur = toEN(lat, lon);
      if (lastGpsEN) {
        const de = cur.e - lastGpsEN.e;
        const dn = cur.n - lastGpsEN.n;
        const step = Math.hypot(de, dn);
        if (step >= minStep) {
          const newHeading = Math.atan2(dn, de);
          if (!headingInit) {
            heading = newHeading;
            headingInit = true;
          } else {
            // shortest-arc smoothing
            let diff = newHeading - heading;
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;
            heading += diff * hSmooth;
          }
          // Re-anchor velocity to GPS-derived speed to kill IMU drift.
          const dtGps = Math.max(0.05, s.ts - lastGpsEN.ts);
          ve = de / dtGps;
          vn = dn / dtGps;
        }
      }
      lastGpsEN = { e: cur.e, n: cur.n, ts: s.ts };

      // 3. Complementary correction toward GPS.
      pe = alpha * pe + (1 - alpha) * cur.e;
      pn = alpha * pn + (1 - alpha) * cur.n;

      // Seed position if this is the first GPS we see post-init.
      if (out.length === 0) {
        pe = cur.e;
        pn = cur.n;
      }
    }

    if (out.length > 0 || gpsValid) {
      const ll = toLatLon(pe, pn);
      out.push({ ts: s.ts, lat: ll.lat, lon: ll.lon });
    }
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
