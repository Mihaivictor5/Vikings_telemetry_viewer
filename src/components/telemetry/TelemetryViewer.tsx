import { useEffect, useMemo, useState } from "react";
import { Activity, Plus, RotateCcw, Upload, Flame, GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChartPanel } from "./ChartPanel";
import { TrackMap } from "./TrackMap";
import { LapTable } from "./LapTable";
import { LiveStats } from "./LiveStats";
import { detectLaps, formatLapTime } from "@/lib/telemetry/laps";
import type { Lap, TelemetryDataset, TelemetrySample } from "@/lib/telemetry/types";

type CoordSource = "INS" | "GNSS" | "FUSED" | "BOTH";

interface Props {
  ds: TelemetryDataset;
  onReset: () => void;
}

interface PanelConfig {
  id: string;
  channels: string[];
}

const DEFAULT_PANELS: PanelConfig[] = [
  { id: "p1", channels: ["speed"] },
  { id: "p2", channels: ["throttle", "brakeFront", "brakeRear"] },
  { id: "p3", channels: ["steerAngle"] },
];

/** Channels offered as heatmap sources — driver inputs only. */
const HEATMAP_CHANNELS = ["speed", "throttle", "brakeFront", "brakeRear", "steerAngle"];

export function TelemetryViewer({ ds, onReset }: Props) {
  const [startLine, setStartLine] = useState<{ lat: number; lon: number } | undefined>();
  const [pickMode, setPickMode] = useState(false);
  const [selectedLap, setSelectedLap] = useState<number | null>(null);
  const [compareLap, setCompareLap] = useState<number | null>(null);
  const [cursorTs, setCursorTs] = useState<number | null>(null);
  const [panels, setPanels] = useState<PanelConfig[]>(DEFAULT_PANELS);
  const [coordSource, setCoordSource] = useState<CoordSource>("INS");
  const [heatmapChannel, setHeatmapChannel] = useState<string | null>(null);

  // Filter defaults to only include channels that actually exist
  useEffect(() => {
    const keys = new Set(ds.channels.map((c) => c.key));
    setPanels((prev) =>
      prev.map((p) => ({ ...p, channels: p.channels.filter((k) => keys.has(k)) }))
    );
  }, [ds]);

  const laps: Lap[] = useMemo(
    () => detectLaps(ds, startLine ? { start: startLine } : {}),
    [ds, startLine]
  );

  const lapMarkers = useMemo(() => laps.map((l) => l.startTs), [laps]);

  // Available driver-input channels (only those present in this dataset).
  const heatmapOptions = useMemo(() => {
    return HEATMAP_CHANNELS
      .map((k) => ds.channels.find((c) => c.key === k))
      .filter((c): c is NonNullable<typeof c> => !!c);
  }, [ds]);

  const heatmapMeta = useMemo(
    () => (heatmapChannel ? ds.channels.find((c) => c.key === heatmapChannel) : null),
    [heatmapChannel, ds]
  );

  // Bounds the user can zoom within (full session, or active lap)
  const [boundsStartTs, boundsEndTs] = useMemo<[number, number]>(() => {
    if (selectedLap != null) {
      const lap = laps.find((l) => l.index === selectedLap);
      if (lap) return [lap.startTs, lap.endTs];
    }
    if (ds.samples.length === 0) return [0, 0];
    return [ds.samples[0].ts, ds.samples[ds.samples.length - 1].ts];
  }, [selectedLap, laps, ds]);

  // Current zoom window — defaults to bounds. Reset whenever bounds change.
  const [view, setView] = useState<[number, number]>([boundsStartTs, boundsEndTs]);
  useEffect(() => {
    setView([boundsStartTs, boundsEndTs]);
  }, [boundsStartTs, boundsEndTs]);

  // Build overlay samples for the compare lap (rebased to start at boundsStartTs).
  const overlaySamples: TelemetrySample[] | null = useMemo(() => {
    if (compareLap == null) return null;
    if (selectedLap == null) return null; // overlay only meaningful with a primary lap selected
    if (compareLap === selectedLap) return null;
    const lap = laps.find((l) => l.index === compareLap);
    if (!lap) return null;
    const slice = ds.samples.slice(lap.startIdx, lap.endIdx + 1);
    if (slice.length === 0) return null;
    const t0 = slice[0].ts;
    return slice.map((s) => ({ ...s, ts: boundsStartTs + (s.ts - t0) }));
  }, [compareLap, selectedLap, laps, ds, boundsStartTs]);

  const compareLapMeta = compareLap != null ? laps.find((l) => l.index === compareLap) : null;

  const bestLap = laps.length
    ? laps.reduce((b, l) => (l.duration < b.duration ? l : b), laps[0])
    : null;

  const addPanel = () => {
    setPanels((p) => [...p, { id: `p${Date.now()}`, channels: [] }]);
  };

  const updatePanel = (id: string, channels: string[]) => {
    setPanels((p) => p.map((x) => (x.id === id ? { ...x, channels } : x)));
  };

  const removePanel = (id: string) => {
    setPanels((p) => p.filter((x) => x.id !== id));
  };

  const onViewChange = (s: number, e: number) => setView([s, e]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-surface-1 px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">
              Vikings Telemetry
            </div>
            <div className="font-mono-tabular text-[10px] text-muted-foreground">
              {ds.fileNames.gns} · {ds.fileNames.ins}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <Stat label="Duration" value={`${ds.duration.toFixed(1)}s`} />
          <Stat label="Samples" value={ds.samples.length.toLocaleString()} />
          <Stat
            label="Best lap"
            value={bestLap ? formatLapTime(bestLap.duration) : "—"}
            accent
          />
          <Button variant="ghost" size="sm" className="h-8" onClick={onReset}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            New session
          </Button>
        </div>
      </header>

      {/* Live values strip */}
      <div className="shrink-0 border-b border-border bg-surface-1/50 px-4 py-2">
        <LiveStats samples={ds.samples} channels={ds.channels} cursorTs={cursorTs} />
      </div>

      {/* Body */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 lg:grid-cols-[1fr_360px]">
        {/* Charts column */}
        <div className="scrollbar-thin flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Channels
              {selectedLap != null && (
                <span className="ml-2 rounded-sm bg-accent px-1.5 py-0.5 text-accent-foreground">
                  Lap {selectedLap} · {formatLapTime(laps.find(l => l.index === selectedLap)?.duration ?? 0)}
                </span>
              )}
              {compareLapMeta && (
                <span className="ml-1 rounded-sm border border-dashed border-chan-5 px-1.5 py-0.5 font-mono-tabular text-chan-5">
                  vs Lap {compareLapMeta.index} · {formatLapTime(compareLapMeta.duration)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {/* Compare-lap dropdown */}
              {selectedLap != null && laps.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={compareLap != null ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2 text-xs"
                    >
                      <GitCompare className="mr-1 h-3 w-3" />
                      {compareLap != null ? `vs Lap ${compareLap}` : "Compare lap"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-[50vh] overflow-y-auto">
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Overlay against Lap {selectedLap}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {compareLap != null && (
                      <>
                        <DropdownMenuItem
                          onClick={() => setCompareLap(null)}
                          className="text-xs text-muted-foreground"
                        >
                          Clear comparison
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    {laps
                      .filter((l) => l.index !== selectedLap)
                      .map((l) => (
                        <DropdownMenuItem
                          key={l.index}
                          onClick={() => setCompareLap(l.index)}
                          className="text-xs font-mono-tabular"
                        >
                          <span>Lap {l.index}</span>
                          <span className="ml-auto text-muted-foreground">
                            {formatLapTime(l.duration)}
                          </span>
                          {compareLap === l.index && (
                            <span className="ml-2 text-primary">●</span>
                          )}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {selectedLap != null && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setSelectedLap(null);
                    setCompareLap(null);
                  }}
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  Full session
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={addPanel}>
                <Plus className="mr-1 h-3 w-3" />
                Add panel
              </Button>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Tip: scroll to zoom · click & drag to pan · double-click to reset
          </div>
          {panels.map((p, i) => (
            <ChartPanel
              key={p.id}
              samples={ds.samples}
              channels={ds.channels}
              selected={p.channels}
              onSelectedChange={(c) => updatePanel(p.id, c)}
              boundsStartTs={boundsStartTs}
              boundsEndTs={boundsEndTs}
              viewStartTs={view[0]}
              viewEndTs={view[1]}
              onViewChange={onViewChange}
              cursorTs={cursorTs}
              onCursorChange={setCursorTs}
              onRemove={panels.length > 1 ? () => removePanel(p.id) : undefined}
              title={`Panel ${i + 1}`}
              lapMarkers={selectedLap == null ? lapMarkers : []}
              overlaySamples={overlaySamples}
              overlayLabel={compareLapMeta ? `Lap ${compareLapMeta.index}` : undefined}
            />
          ))}
        </div>

        {/* Right: map + laps */}
        <aside className="grid min-h-0 grid-rows-[1fr_auto] gap-2 lg:grid-rows-[1fr_320px]">
          <div className="flex min-h-[300px] flex-col rounded-md border border-border bg-surface-1">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                Track Map
              </span>
              <div className="flex items-center gap-1.5">
                {/* Heatmap toggle */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant={heatmapChannel ? "default" : "ghost"}
                      className="h-7 px-2 text-[10px] uppercase tracking-widest"
                      title="Color the track by a driver-input channel"
                    >
                      <Flame className="mr-1 h-3 w-3" />
                      {heatmapMeta ? heatmapMeta.label : "Heatmap"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Color by
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setHeatmapChannel(null)}
                      className="text-xs"
                    >
                      Off
                      {heatmapChannel === null && <span className="ml-auto text-primary">●</span>}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {heatmapOptions.map((c) => (
                      <DropdownMenuItem
                        key={c.key}
                        onClick={() => setHeatmapChannel(c.key)}
                        className="text-xs font-mono-tabular"
                      >
                        <span>{c.label}</span>
                        {c.unit && <span className="ml-1 text-muted-foreground">[{c.unit}]</span>}
                        {heatmapChannel === c.key && (
                          <span className="ml-auto text-primary">●</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="flex rounded-sm border border-border bg-surface-2 p-0.5">
                  {(["INS", "GNSS", "FUSED", "BOTH"] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setCoordSource(opt)}
                      className={[
                        "rounded-[3px] px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest transition-colors",
                        coordSource === opt
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      ].join(" ")}
                      title={
                        opt === "INS"
                          ? "Onboard INS fusion (logger output)"
                          : opt === "GNSS"
                          ? "Raw GNSS positions"
                          : opt === "FUSED"
                          ? "IMU + GPS complementary fusion (computed)"
                          : "Side-by-side comparison"
                      }
                    >
                      {opt === "INS" ? "INS" : opt === "GNSS" ? "GNSS" : opt === "FUSED" ? "IMU+GPS" : "Split"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="relative flex-1">
              {coordSource === "BOTH" ? (
                <div className="absolute inset-0 grid grid-cols-2 gap-px bg-border">
                  <div className="relative bg-surface-1">
                    <TrackMap
                      ds={ds}
                      laps={laps}
                      selectedLap={selectedLap}
                      cursorTs={cursorTs}
                      startLine={startLine}
                      onSetStartLine={(p) => {
                        setStartLine(p);
                        setPickMode(false);
                      }}
                      startLinePickMode={pickMode}
                      source="INS"
                      heatmapChannel={heatmapChannel}
                      heatmapLabel={heatmapMeta?.label}
                      heatmapUnit={heatmapMeta?.unit}
                    />
                    <MapBadge>INS · fused</MapBadge>
                  </div>
                  <div className="relative bg-surface-1">
                    <TrackMap
                      ds={ds}
                      laps={laps}
                      selectedLap={selectedLap}
                      cursorTs={cursorTs}
                      startLine={startLine}
                      onSetStartLine={(p) => {
                        setStartLine(p);
                        setPickMode(false);
                      }}
                      startLinePickMode={pickMode}
                      source="GNSS"
                      heatmapChannel={heatmapChannel}
                      heatmapLabel={heatmapMeta?.label}
                      heatmapUnit={heatmapMeta?.unit}
                    />
                    <MapBadge>GNSS · raw</MapBadge>
                  </div>
                </div>
              ) : (
                <TrackMap
                  ds={ds}
                  laps={laps}
                  selectedLap={selectedLap}
                  cursorTs={cursorTs}
                  startLine={startLine}
                  onSetStartLine={(p) => {
                    setStartLine(p);
                    setPickMode(false);
                  }}
                  startLinePickMode={pickMode}
                  source={coordSource}
                  heatmapChannel={heatmapChannel}
                  heatmapLabel={heatmapMeta?.label}
                  heatmapUnit={heatmapMeta?.unit}
                />
              )}
            </div>
          </div>
          <LapTable
            laps={laps}
            selectedLap={selectedLap}
            onSelect={(l) => {
              setSelectedLap(l);
              if (l == null) setCompareLap(null);
            }}
            pickMode={pickMode}
            onTogglePick={() => setPickMode((v) => !v)}
          />
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span
        className={[
          "font-mono-tabular text-sm",
          accent ? "text-chan-5 font-semibold" : "text-foreground",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

function MapBadge({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute left-2 top-2 z-[400] rounded-sm border border-border bg-popover/85 px-2 py-0.5 font-mono-tabular text-[10px] uppercase tracking-widest text-muted-foreground backdrop-blur">
      {children}
    </div>
  );
}
