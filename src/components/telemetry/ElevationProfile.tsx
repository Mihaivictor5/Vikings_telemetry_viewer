import { useMemo } from "react";
import { Mountain } from "lucide-react";
import type { TelemetrySample } from "@/lib/telemetry/types";

interface Props {
  samples: TelemetrySample[];
  altKey?: string;
  latKey?: string;
  lonKey?: string;
  startIdx: number;
  endIdx: number;
  cursorTs: number | null;
  onCursorChange: (ts: number | null) => void;
}

const W = 600; // viewBox width
const H = 80; // viewBox height
const PAD_T = 6;
const PAD_B = 14;
const PAD_L = 28;
const PAD_R = 6;

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

export function ElevationProfile({
  samples,
  altKey,
  latKey,
  lonKey,
  startIdx,
  endIdx,
  cursorTs,
  onCursorChange,
}: Props) {
  const data = useMemo(() => {
    if (!altKey) return null;
    const pts: Array<{ d: number; alt: number; ts: number }> = [];
    let cumDist = 0;
    let prevLat: number | null = null;
    let prevLon: number | null = null;
    let minAlt = Infinity;
    let maxAlt = -Infinity;
    for (let i = startIdx; i <= endIdx; i++) {
      const s = samples[i];
      if (!s) continue;
      const alt = s.v[altKey];
      if (latKey && lonKey) {
        const lat = s.v[latKey];
        const lon = s.v[lonKey];
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lon) &&
          lat !== 0 &&
          lon !== 0
        ) {
          if (prevLat != null && prevLon != null) {
            const step = haversine(prevLat, prevLon, lat, lon);
            if (step < 50) cumDist += step; // skip glitches
          }
          prevLat = lat;
          prevLon = lon;
        }
      }
      if (Number.isFinite(alt)) {
        if (alt < minAlt) minAlt = alt;
        if (alt > maxAlt) maxAlt = alt;
        pts.push({ d: cumDist, alt, ts: s.ts });
      }
    }
    if (pts.length < 2 || !Number.isFinite(minAlt)) return null;
    const span = Math.max(0.5, maxAlt - minAlt);
    return { pts, minAlt, maxAlt, span, totalDist: cumDist };
  }, [samples, altKey, latKey, lonKey, startIdx, endIdx]);

  const path = useMemo(() => {
    if (!data) return "";
    const { pts, minAlt, span, totalDist } = data;
    const totalD = Math.max(1, totalDist);
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;
    let d = "";
    for (let i = 0; i < pts.length; i++) {
      const x = PAD_L + (pts[i].d / totalD) * innerW;
      const y = PAD_T + innerH - ((pts[i].alt - minAlt) / span) * innerH;
      d += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
    }
    // close to bottom for fill
    const lastX = PAD_L + innerW;
    const baseY = PAD_T + innerH;
    const fill = d + `L${lastX.toFixed(1)},${baseY} L${PAD_L},${baseY} Z`;
    return { stroke: d, fill };
  }, [data]);

  const cursorX = useMemo(() => {
    if (!data || cursorTs == null) return null;
    const { pts, totalDist } = data;
    // find sample by ts
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].ts < cursorTs) lo = mid + 1;
      else hi = mid;
    }
    const p = pts[lo];
    const innerW = W - PAD_L - PAD_R;
    return {
      x: PAD_L + (p.d / Math.max(1, totalDist)) * innerW,
      alt: p.alt,
    };
  }, [data, cursorTs]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!data) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const xVb = (xPx / rect.width) * W;
    const innerW = W - PAD_L - PAD_R;
    const frac = Math.max(0, Math.min(1, (xVb - PAD_L) / innerW));
    // map fraction back to sample ts
    const targetD = frac * data.totalDist;
    let lo = 0;
    let hi = data.pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (data.pts[mid].d < targetD) lo = mid + 1;
      else hi = mid;
    }
    onCursorChange(data.pts[lo].ts);
  };

  return (
    <div className="flex flex-col rounded-md border border-border bg-surface-1">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Mountain className="h-3.5 w-3.5 text-chan-3" />
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Elevation Profile
          </span>
        </div>
        {data && (
          <div className="flex items-center gap-3 font-mono-tabular text-[10px] text-muted-foreground">
            <span>
              Δ <span className="text-foreground">{(data.maxAlt - data.minAlt).toFixed(1)} m</span>
            </span>
            <span>
              min <span className="text-foreground">{data.minAlt.toFixed(1)}</span>
            </span>
            <span>
              max <span className="text-foreground">{data.maxAlt.toFixed(1)}</span>
            </span>
          </div>
        )}
      </div>
      <div className="relative px-1 py-1">
        {!data ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            No altitude data available.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="block h-[80px] w-full cursor-crosshair"
            onMouseMove={onMove}
            onMouseLeave={() => onCursorChange(null)}
          >
            {/* baseline */}
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={H - PAD_B}
              y2={H - PAD_B}
              stroke="hsl(var(--grid))"
              strokeWidth={0.5}
            />
            {/* fill */}
            <path d={path.fill} fill="hsl(var(--chan-3) / 0.15)" />
            {/* stroke */}
            <path
              d={path.stroke}
              fill="none"
              stroke="hsl(var(--chan-3))"
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
            />
            {/* min / max labels */}
            <text
              x={PAD_L - 3}
              y={PAD_T + 6}
              textAnchor="end"
              fontSize="8"
              fill="hsl(var(--muted-foreground))"
              fontFamily="ui-monospace, monospace"
            >
              {data.maxAlt.toFixed(0)}
            </text>
            <text
              x={PAD_L - 3}
              y={H - PAD_B - 1}
              textAnchor="end"
              fontSize="8"
              fill="hsl(var(--muted-foreground))"
              fontFamily="ui-monospace, monospace"
            >
              {data.minAlt.toFixed(0)}
            </text>
            <text
              x={W - PAD_R}
              y={H - 2}
              textAnchor="end"
              fontSize="8"
              fill="hsl(var(--muted-foreground))"
              fontFamily="ui-monospace, monospace"
            >
              {(data.totalDist / 1000).toFixed(2)} km
            </text>
            {cursorX && (
              <>
                <line
                  x1={cursorX.x}
                  x2={cursorX.x}
                  y1={PAD_T}
                  y2={H - PAD_B}
                  stroke="hsl(var(--primary))"
                  strokeWidth={0.8}
                  strokeDasharray="2,2"
                />
                <text
                  x={Math.min(W - PAD_R, cursorX.x + 3)}
                  y={PAD_T + 7}
                  fontSize="9"
                  fill="hsl(var(--primary))"
                  fontFamily="ui-monospace, monospace"
                  fontWeight="600"
                >
                  {cursorX.alt.toFixed(1)} m
                </text>
              </>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
