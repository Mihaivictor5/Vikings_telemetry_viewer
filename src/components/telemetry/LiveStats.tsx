import { findSampleIndexByTs } from "@/lib/telemetry/downsample";
import type { ChannelDef, TelemetrySample } from "@/lib/telemetry/types";
import { useMemo } from "react";

interface Props {
  samples: TelemetrySample[];
  channels: ChannelDef[];
  cursorTs: number | null;
  speedKey?: string;
}

const STAT_CHANNELS: Array<{ key: string; label: string; unit: string }> = [
  { key: "speed", label: "Speed", unit: "km/h" },
  { key: "throttle", label: "Throttle", unit: "%" },
  { key: "brakeFront", label: "Brake F", unit: "%" },
  { key: "brakeRear", label: "Brake R", unit: "%" },
  { key: "steerAngle", label: "Steer", unit: "°" },
  { key: "insAlt", label: "Altitude", unit: "m" },
  { key: "packV", label: "Pack V", unit: "V" },
  { key: "motorMaxT", label: "Motor T", unit: "°C" },
];

export function LiveStats({ samples, channels, cursorTs }: Props) {
  const sample = useMemo(() => {
    if (samples.length === 0) return null;
    if (cursorTs == null) return samples[samples.length - 1];
    return samples[findSampleIndexByTs(samples, cursorTs)];
  }, [samples, cursorTs]);

  const available = useMemo(() => {
    const keys = new Set(channels.map((c) => c.key));
    return STAT_CHANNELS.filter((s) => keys.has(s.key));
  }, [channels]);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
      {available.map((s) => {
        const v = sample?.v[s.key];
        return (
          <div
            key={s.key}
            className="rounded-md border border-border bg-surface-2 px-3 py-2"
          >
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {s.label}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="font-mono-tabular text-lg font-semibold text-foreground">
                {Number.isFinite(v) ? (v as number).toFixed(1) : "—"}
              </span>
              <span className="text-[10px] text-muted-foreground">{s.unit}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
