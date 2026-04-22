import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo, useRef, useState, type WheelEvent, type MouseEvent } from "react";
import { Plus, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { downsample, findSampleIndexByTs } from "@/lib/telemetry/downsample";
import { colorForIndex } from "@/lib/telemetry/colors";
import type { ChannelDef, TelemetrySample } from "@/lib/telemetry/types";

interface Props {
  samples: TelemetrySample[];
  channels: ChannelDef[];
  selected: string[];
  onSelectedChange: (keys: string[]) => void;
  /** Bounds the user can zoom within (full session or active lap). */
  boundsStartTs: number;
  boundsEndTs: number;
  /** Current visible window (ts range). */
  viewStartTs: number;
  viewEndTs: number;
  onViewChange: (startTs: number, endTs: number) => void;
  cursorTs: number | null;
  onCursorChange: (ts: number | null) => void;
  onRemove?: () => void;
  title?: string;
  height?: number;
  lapMarkers?: number[];
  /** Optional second-lap data for overlay (already shifted so it starts at viewStartTs). */
  overlaySamples?: TelemetrySample[] | null;
  overlayLabel?: string;
}

export function ChartPanel({
  samples,
  channels,
  selected,
  onSelectedChange,
  boundsStartTs,
  boundsEndTs,
  viewStartTs,
  viewEndTs,
  onViewChange,
  cursorTs,
  onCursorChange,
  onRemove,
  title,
  height = 220,
  lapMarkers = [],
  overlaySamples = null,
  overlayLabel,
}: Props) {
  const [startIdx, endIdx] = useMemo(
    () => [
      findSampleIndexByTs(samples, viewStartTs),
      findSampleIndexByTs(samples, viewEndTs),
    ],
    [samples, viewStartTs, viewEndTs]
  );

  const baseData = useMemo(
    () => downsample(samples, selected, 1200, startIdx, endIdx),
    [samples, selected, startIdx, endIdx]
  );

  // Overlay: re-time so both laps share the same X axis (elapsed-time aligned).
  const overlayKeys = useMemo(() => selected.map((k) => `${k}__cmp`), [selected]);
  const data = useMemo(() => {
    if (!overlaySamples || overlaySamples.length === 0) return baseData;
    const oStart = overlaySamples[0].ts;
    const wantedSpan = viewEndTs - viewStartTs;
    const oEnd = Math.min(overlaySamples[overlaySamples.length - 1].ts, oStart + wantedSpan);
    const oStartIdx = findSampleIndexByTs(overlaySamples, oStart);
    const oEndIdx = findSampleIndexByTs(overlaySamples, oEnd);
    const overlayData = downsample(overlaySamples, selected, 1200, oStartIdx, oEndIdx);
    // Rebase overlay ts so it starts at viewStartTs and rename keys.
    const rebased = overlayData.map((row) => {
      const o: Record<string, number> = { ts: viewStartTs + (row.ts - oStart) };
      for (const k of selected) o[`${k}__cmp`] = row[k];
      return o;
    });
    // Merge: for each base row, find nearest overlay row by ts and copy cmp keys.
    const merged = baseData.map((row) => ({ ...row }));
    let j = 0;
    for (const row of merged) {
      while (j + 1 < rebased.length && Math.abs(rebased[j + 1].ts - row.ts) < Math.abs(rebased[j].ts - row.ts)) {
        j++;
      }
      const nearest = rebased[j];
      if (nearest && Math.abs(nearest.ts - row.ts) < 0.5) {
        for (const k of overlayKeys) row[k] = nearest[k];
      }
    }
    return merged;
  }, [baseData, overlaySamples, selected, overlayKeys, viewStartTs, viewEndTs]);

  const channelMap = useMemo(() => {
    const m = new Map<string, ChannelDef>();
    for (const c of channels) m.set(c.key, c);
    return m;
  }, [channels]);

  const groups = useMemo(() => {
    const g = new Map<string, ChannelDef[]>();
    for (const c of channels) {
      if (!g.has(c.group)) g.set(c.group, []);
      g.get(c.group)!.push(c);
    }
    return Array.from(g.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [channels]);

  const toggle = (key: string) => {
    if (selected.includes(key)) onSelectedChange(selected.filter((k) => k !== key));
    else onSelectedChange([...selected, key]);
  };

  // ---- zoom + pan -----------------------------------------------------------
  const plotRef = useRef<HTMLDivElement>(null);
  const [panState, setPanState] = useState<{ startX: number; startTs: number; endTs: number } | null>(null);

  const tsFromClientX = (clientX: number): number | null => {
    const el = plotRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    // Recharts inner plot area: left margin 0 + YAxis width 48; right margin 12.
    const left = rect.left + 48;
    const right = rect.right - 12;
    const width = right - left;
    if (width <= 0) return null;
    const frac = Math.min(1, Math.max(0, (clientX - left) / width));
    return viewStartTs + frac * (viewEndTs - viewStartTs);
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (boundsEndTs <= boundsStartTs) return;
    e.preventDefault();
    const anchor = tsFromClientX(e.clientX) ?? (viewStartTs + viewEndTs) / 2;
    const span = viewEndTs - viewStartTs;
    // wheel up (negative deltaY) = zoom in
    const factor = Math.exp(e.deltaY * 0.0015);
    const minSpan = Math.max(0.05, (boundsEndTs - boundsStartTs) / 2000);
    const maxSpan = boundsEndTs - boundsStartTs;
    const newSpan = Math.min(maxSpan, Math.max(minSpan, span * factor));
    const fracLeft = (anchor - viewStartTs) / span;
    let newStart = anchor - fracLeft * newSpan;
    let newEnd = newStart + newSpan;
    if (newStart < boundsStartTs) {
      newStart = boundsStartTs;
      newEnd = newStart + newSpan;
    }
    if (newEnd > boundsEndTs) {
      newEnd = boundsEndTs;
      newStart = newEnd - newSpan;
    }
    onViewChange(newStart, newEnd);
  };

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setPanState({ startX: e.clientX, startTs: viewStartTs, endTs: viewEndTs });
  };
  const handleMouseMoveDiv = (e: MouseEvent<HTMLDivElement>) => {
    if (!panState) return;
    const el = plotRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = rect.width - 48 - 12;
    if (width <= 0) return;
    const span = panState.endTs - panState.startTs;
    const dxFrac = (e.clientX - panState.startX) / width;
    const dt = -dxFrac * span;
    let newStart = panState.startTs + dt;
    let newEnd = panState.endTs + dt;
    if (newStart < boundsStartTs) {
      newStart = boundsStartTs;
      newEnd = newStart + span;
    }
    if (newEnd > boundsEndTs) {
      newEnd = boundsEndTs;
      newStart = newEnd - span;
    }
    onViewChange(newStart, newEnd);
  };
  const endPan = () => setPanState(null);

  const handleDoubleClick = () => {
    onViewChange(boundsStartTs, boundsEndTs);
  };

  const isZoomed = viewStartTs > boundsStartTs + 0.001 || viewEndTs < boundsEndTs - 0.001;

  return (
    <div className="flex flex-col rounded-md border border-border bg-surface-1">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {title && (
            <span className="mr-2 text-[11px] uppercase tracking-widest text-muted-foreground">
              {title}
            </span>
          )}
          {selected.length === 0 && (
            <span className="text-xs text-muted-foreground">No channels — add one →</span>
          )}
          {selected.map((k, i) => {
            const ch = channelMap.get(k);
            if (!ch) return null;
            return (
              <button
                key={k}
                onClick={() => toggle(k)}
                className="group flex items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-2 py-0.5 text-xs hover:border-destructive"
                title="Click to remove"
              >
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ backgroundColor: colorForIndex(i) }}
                />
                <span className="font-mono-tabular text-foreground">{ch.label}</span>
                {ch.unit && <span className="text-muted-foreground">[{ch.unit}]</span>}
                <X className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </button>
            );
          })}
          {overlaySamples && overlayLabel && (
            <span className="ml-1 rounded-sm border border-dashed border-chan-5 px-1.5 py-0.5 font-mono-tabular text-[10px] uppercase tracking-widest text-chan-5">
              vs {overlayLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isZoomed && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[10px] uppercase tracking-widest text-muted-foreground"
              onClick={handleDoubleClick}
              title="Reset zoom (or double-click chart)"
            >
              Reset zoom
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 px-2">
                <Plus className="h-3.5 w-3.5" />
                <span className="ml-1 text-xs">Channel</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-[60vh] overflow-y-auto" align="end">
              <DropdownMenuLabel className="text-xs uppercase tracking-widest text-muted-foreground">
                Channels
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {groups.map(([group, list]) => (
                <DropdownMenuSub key={group}>
                  <DropdownMenuSubTrigger className="text-xs">{group}</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="max-h-[60vh] overflow-y-auto">
                      {list.map((c) => (
                        <DropdownMenuItem
                          key={c.key}
                          onClick={() => toggle(c.key)}
                          className="text-xs"
                        >
                          <span className="font-mono-tabular">{c.label}</span>
                          {c.unit && (
                            <span className="ml-1 text-muted-foreground">[{c.unit}]</span>
                          )}
                          {selected.includes(c.key) && (
                            <span className="ml-auto text-primary">●</span>
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {onRemove && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onRemove}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div
        ref={plotRef}
        style={{ height, cursor: panState ? "grabbing" : "grab" }}
        className="select-none px-2 py-1"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMoveDiv}
        onMouseUp={endPan}
        onMouseLeave={endPan}
        onDoubleClick={handleDoubleClick}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
            onMouseMove={(s) => {
              if (panState) return;
              if (s && s.activeLabel != null) {
                const v = typeof s.activeLabel === "number"
                  ? s.activeLabel
                  : parseFloat(String(s.activeLabel));
                if (Number.isFinite(v)) onCursorChange(v);
              }
            }}
            onMouseLeave={() => onCursorChange(null)}
          >
            <CartesianGrid stroke="hsl(var(--grid))" strokeDasharray="2 4" />
            <XAxis
              dataKey="ts"
              type="number"
              domain={[viewStartTs, viewEndTs]}
              allowDataOverflow
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              tickFormatter={(v) => `${Number(v).toFixed(1)}s`}
              stroke="hsl(var(--border))"
            />
            <YAxis
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              stroke="hsl(var(--border))"
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 4,
                fontSize: 11,
              }}
              labelStyle={{ color: "hsl(var(--muted-foreground))" }}
              itemStyle={{ color: "hsl(var(--foreground))" }}
              labelFormatter={(v) => `t = ${Number(v).toFixed(3)}s`}
              formatter={(value: number, name: string) => {
                const isCmp = name.endsWith("__cmp");
                const baseKey = isCmp ? name.slice(0, -5) : name;
                const ch = channelMap.get(baseKey);
                const label = ch ? `${ch.label}${ch.unit ? ` [${ch.unit}]` : ""}` : baseKey;
                return [
                  Number.isFinite(value) ? value.toFixed(3) : "—",
                  isCmp ? `${label} · ${overlayLabel ?? "cmp"}` : label,
                ];
              }}
            />
            {lapMarkers.map((ts, i) => (
              <ReferenceLine
                key={i}
                x={ts}
                stroke="hsl(var(--chan-2))"
                strokeDasharray="2 2"
                strokeOpacity={0.5}
              />
            ))}
            {cursorTs != null && (
              <ReferenceLine
                x={cursorTs}
                stroke="hsl(var(--primary))"
                strokeOpacity={0.8}
              />
            )}
            {selected.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={colorForIndex(i)}
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
                connectNulls
              />
            ))}
            {overlaySamples && selected.map((k, i) => (
              <Line
                key={`${k}__cmp`}
                type="monotone"
                dataKey={`${k}__cmp`}
                stroke={colorForIndex(i)}
                strokeDasharray="4 3"
                strokeOpacity={0.75}
                dot={false}
                strokeWidth={1.25}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
