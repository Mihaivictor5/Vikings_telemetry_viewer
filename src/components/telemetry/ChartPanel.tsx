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
import { useMemo } from "react";
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
import { downsample } from "@/lib/telemetry/downsample";
import { colorForIndex } from "@/lib/telemetry/colors";
import type { ChannelDef, TelemetrySample } from "@/lib/telemetry/types";

interface Props {
  samples: TelemetrySample[];
  channels: ChannelDef[];
  selected: string[];
  onSelectedChange: (keys: string[]) => void;
  startIdx: number;
  endIdx: number;
  cursorTs: number | null;
  onCursorChange: (ts: number | null) => void;
  onRemove?: () => void;
  title?: string;
  height?: number;
  lapMarkers?: number[];
}

export function ChartPanel({
  samples,
  channels,
  selected,
  onSelectedChange,
  startIdx,
  endIdx,
  cursorTs,
  onCursorChange,
  onRemove,
  title,
  height = 220,
  lapMarkers = [],
}: Props) {
  const data = useMemo(
    () => downsample(samples, selected, 1200, startIdx, endIdx),
    [samples, selected, startIdx, endIdx]
  );

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
        </div>
        <div className="flex items-center gap-1">
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

      <div style={{ height }} className="px-2 py-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
            onMouseMove={(s) => {
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
              domain={["dataMin", "dataMax"]}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              tickFormatter={(v) => `${v.toFixed(1)}s`}
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
                const ch = channelMap.get(name);
                return [
                  Number.isFinite(value) ? value.toFixed(3) : "—",
                  ch ? `${ch.label}${ch.unit ? ` [${ch.unit}]` : ""}` : name,
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
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
