import { TelemetrySample } from "./types";

/**
 * LTTB-ish downsample for line charts.
 * For perf, just bucket-average if N > target. Preserves min/max approximately.
 */
export function downsample(
  samples: TelemetrySample[],
  keys: string[],
  target = 1500,
  startIdx = 0,
  endIdx = samples.length - 1
): Array<Record<string, number>> {
  const n = endIdx - startIdx + 1;
  if (n <= 0) return [];
  if (n <= target) {
    return samples.slice(startIdx, endIdx + 1).map((s) => {
      const o: Record<string, number> = { ts: s.ts };
      for (const k of keys) o[k] = s.v[k];
      return o;
    });
  }
  const bucketSize = n / target;
  const out: Array<Record<string, number>> = [];
  for (let b = 0; b < target; b++) {
    const lo = startIdx + Math.floor(b * bucketSize);
    const hi = Math.min(endIdx, startIdx + Math.floor((b + 1) * bucketSize) - 1);
    const mid = Math.floor((lo + hi) / 2);
    const s = samples[mid];
    const o: Record<string, number> = { ts: s.ts };
    for (const k of keys) {
      // average over bucket for smoother lines
      let sum = 0;
      let count = 0;
      for (let i = lo; i <= hi; i++) {
        const v = samples[i].v[k];
        if (Number.isFinite(v)) {
          sum += v;
          count++;
        }
      }
      o[k] = count ? sum / count : NaN;
    }
    out.push(o);
  }
  return out;
}

export function findSampleIndexByTs(samples: TelemetrySample[], ts: number): number {
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].ts < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
