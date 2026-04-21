import { useEffect, useMemo, useState } from "react";
import { Activity, Plus, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartPanel } from "./ChartPanel";
import { TrackMap } from "./TrackMap";
import { LapTable } from "./LapTable";
import { LiveStats } from "./LiveStats";
import { detectLaps, formatLapTime } from "@/lib/telemetry/laps";
import type { Lap, TelemetryDataset } from "@/lib/telemetry/types";

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

export function TelemetryViewer({ ds, onReset }: Props) {
  const [startLine, setStartLine] = useState<{ lat: number; lon: number } | undefined>();
  const [pickMode, setPickMode] = useState(false);
  const [selectedLap, setSelectedLap] = useState<number | null>(null);
  const [cursorTs, setCursorTs] = useState<number | null>(null);
  const [panels, setPanels] = useState<PanelConfig[]>(DEFAULT_PANELS);
  const [coordSource, setCoordSource] = useState<CoordSource>("INS");

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

  // View window — restrict to selected lap if any
  const [startIdx, endIdx] = useMemo(() => {
    if (selectedLap != null) {
      const lap = laps.find((l) => l.index === selectedLap);
      if (lap) return [lap.startIdx, lap.endIdx];
    }
    return [0, ds.samples.length - 1];
  }, [selectedLap, laps, ds]);

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
            </div>
            <div className="flex items-center gap-1">
              {selectedLap != null && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSelectedLap(null)}
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
          {panels.map((p, i) => (
            <ChartPanel
              key={p.id}
              samples={ds.samples}
              channels={ds.channels}
              selected={p.channels}
              onSelectedChange={(c) => updatePanel(p.id, c)}
              startIdx={startIdx}
              endIdx={endIdx}
              cursorTs={cursorTs}
              onCursorChange={setCursorTs}
              onRemove={panels.length > 1 ? () => removePanel(p.id) : undefined}
              title={`Panel ${i + 1}`}
              lapMarkers={selectedLap == null ? lapMarkers : []}
            />
          ))}
        </div>

        {/* Right: map + laps */}
        <aside className="grid min-h-0 grid-rows-[1fr_auto] gap-2 lg:grid-rows-[1fr_320px]">
          <div className="flex min-h-[300px] flex-col rounded-md border border-border bg-surface-1">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                Track Map
              </span>
              <div className="flex items-center gap-1.5">
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
                />
              )}
            </div>
          </div>
          <LapTable
            laps={laps}
            selectedLap={selectedLap}
            onSelect={setSelectedLap}
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
