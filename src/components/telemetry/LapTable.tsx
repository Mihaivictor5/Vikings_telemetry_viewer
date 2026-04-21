import { Flag, MapPin, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatLapTime } from "@/lib/telemetry/laps";
import type { Lap } from "@/lib/telemetry/types";

interface Props {
  laps: Lap[];
  selectedLap: number | null;
  onSelect: (lap: number | null) => void;
  pickMode: boolean;
  onTogglePick: () => void;
}

export function LapTable({ laps, selectedLap, onSelect, pickMode, onTogglePick }: Props) {
  const best = laps.length
    ? laps.reduce((b, l) => (l.duration < b.duration ? l : b), laps[0])
    : null;

  return (
    <div className="flex h-full flex-col rounded-md border border-border bg-surface-1">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Flag className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Laps
          </span>
          <span className="font-mono-tabular text-xs text-foreground">
            {laps.length}
          </span>
        </div>
        <Button
          size="sm"
          variant={pickMode ? "default" : "outline"}
          className="h-7 px-2 text-xs"
          onClick={onTogglePick}
        >
          <MapPin className="mr-1 h-3 w-3" />
          {pickMode ? "Click map…" : "Set start"}
        </Button>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {laps.length === 0 && (
          <div className="p-4 text-center text-xs text-muted-foreground">
            No laps detected. Try setting a start/finish point on the map.
          </div>
        )}
        <table className="w-full text-xs font-mono-tabular">
          <thead className="sticky top-0 bg-surface-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-normal">#</th>
              <th className="px-2 py-1.5 text-right font-normal">Time</th>
              <th className="px-2 py-1.5 text-right font-normal">Δ Best</th>
              <th className="px-2 py-1.5 text-right font-normal">Max km/h</th>
              <th className="px-2 py-1.5 text-right font-normal">Avg</th>
            </tr>
          </thead>
          <tbody>
            {laps.map((l) => {
              const isSelected = selectedLap === l.index;
              const isBest = best?.index === l.index;
              const delta = best ? l.duration - best.duration : 0;
              return (
                <tr
                  key={l.index}
                  onClick={() => onSelect(isSelected ? null : l.index)}
                  className={[
                    "cursor-pointer border-b border-border/50 transition-colors",
                    isSelected ? "bg-accent/40 text-accent-foreground" : "hover:bg-surface-2",
                  ].join(" ")}
                >
                  <td className="px-3 py-1.5 text-left">
                    <span className={isBest ? "text-chan-5" : ""}>{l.index}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={isBest ? "text-chan-5 font-semibold" : ""}>
                      {formatLapTime(l.duration)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">
                    {isBest ? "—" : `+${delta.toFixed(2)}`}
                  </td>
                  <td className="px-2 py-1.5 text-right">{l.maxSpeed.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">
                    {l.avgSpeed.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
