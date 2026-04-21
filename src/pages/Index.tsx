import { useState } from "react";
import { Activity, Gauge, Map as MapIcon, Flag } from "lucide-react";
import { FileUpload } from "@/components/telemetry/FileUpload";
import { TelemetryViewer } from "@/components/telemetry/TelemetryViewer";
import type { TelemetryDataset } from "@/lib/telemetry/types";

const Index = () => {
  const [ds, setDs] = useState<TelemetryDataset | null>(null);

  if (ds) {
    return <TelemetryViewer ds={ds} onReset={() => setDs(null)} />;
  }

  return (
    <main className="grid-bg min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-12">
        <header className="mb-12 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-2 text-primary">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Vikings Telemetry</h1>
              <p className="font-mono-tabular text-[11px] text-muted-foreground">
                FORMULA STUDENT · LIVE DATA VIEWER
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 font-mono-tabular text-[11px] text-muted-foreground sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-chan-3 animate-pulse" />
            ENGINEERING BUILD
          </div>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center">
          <div className="mb-8 max-w-2xl text-center">
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Drop your session files to inspect every channel.
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Load the matching <span className="font-mono-tabular text-foreground">GNS</span> and{" "}
              <span className="font-mono-tabular text-foreground">INS</span> CSV exports to view
              vehicle dynamics, overlay channels, count laps, and trace the car on a sensor-fused map.
            </p>
          </div>

          <FileUpload onLoaded={setDs} />

          <div className="mt-12 grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
            <Feature
              icon={<Gauge className="h-4 w-4" />}
              title="Multi-channel charts"
              text="Overlay any signal on shared time axes. Add or remove panels at will."
            />
            <Feature
              icon={<MapIcon className="h-4 w-4" />}
              title="Sensor-fused map"
              text="Trace the car using INS or raw GNSS. Highlight the lap of interest."
            />
            <Feature
              icon={<Flag className="h-4 w-4" />}
              title="Lap timing"
              text="Auto-detect crossings or set the start line manually for precise laps."
            />
          </div>
        </section>

        <footer className="pt-12 text-center font-mono-tabular text-[10px] text-muted-foreground">
          <p>
            CSVs are processed locally in your browser. No data leaves your machine.
          </p>
        </footer>
      </div>
    </main>
  );
};

function Feature({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-1 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-accent text-primary">
          {icon}
        </span>
        <span className="text-xs font-semibold tracking-tight">{title}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

export default Index;
