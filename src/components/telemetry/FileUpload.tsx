import { Upload, FileSpreadsheet, AlertCircle, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { parseTelemetryFiles } from "@/lib/telemetry/parser";
import type { TelemetryDataset } from "@/lib/telemetry/types";

interface Props {
  onLoaded: (ds: TelemetryDataset) => void;
}

type Slot = "GNS" | "INS";

export function FileUpload({ onLoaded }: Props) {
  const [gns, setGns] = useState<File | null>(null);
  const [ins, setIns] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<Slot | null>(null);

  const assignFile = useCallback((file: File) => {
    const name = file.name.toUpperCase();
    if (name.includes("GNS")) setGns(file);
    else if (name.includes("INS")) setIns(file);
    else if (!gns) setGns(file);
    else setIns(file);
  }, [gns]);

  const handleDrop = (slot: Slot, e: React.DragEvent) => {
    e.preventDefault();
    setDrag(null);
    const files = Array.from(e.dataTransfer.files);
    files.forEach((f) => {
      if (slot === "GNS") setGns(f);
      else setIns(f);
    });
    if (files.length > 1) files.forEach(assignFile);
  };

  const handleLoad = async () => {
    if (!gns || !ins) return;
    setBusy(true);
    setError(null);
    try {
      const ds = await parseTelemetryFiles(gns, ins);
      onLoaded(ds);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse files");
    } finally {
      setBusy(false);
    }
  };

  const Slot = (slot: Slot, file: File | null, setter: (f: File | null) => void) => (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(slot); }}
      onDragLeave={() => setDrag(null)}
      onDrop={(e) => handleDrop(slot, e)}
      className={[
        "group relative flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-8 transition-colors cursor-pointer",
        drag === slot ? "border-primary bg-accent/30" : "border-border bg-surface-2 hover:border-primary/60",
      ].join(" ")}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-surface-3 text-primary">
        {file ? <FileSpreadsheet className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
      </div>
      <div className="text-center">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">{slot} file</div>
        <div className="mt-1 font-mono-tabular text-sm text-foreground">
          {file ? file.name : `Drop ${slot}.csv here`}
        </div>
        {file && (
          <div className="mt-1 text-[11px] text-muted-foreground font-mono-tabular">
            {(file.size / 1024 / 1024).toFixed(2)} MB
          </div>
        )}
      </div>
      <input
        type="file"
        accept=".csv,text/csv"
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(e) => setter(e.target.files?.[0] ?? null)}
      />
    </label>
  );

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Slot("GNS", gns, setGns)}
        {Slot("INS", ins, setIns)}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-6 flex flex-col items-center gap-3">
        <Button
          size="lg"
          disabled={!gns || !ins || busy}
          onClick={handleLoad}
          className="min-w-48"
        >
          {busy ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Parsing telemetry…</>
          ) : (
            "Load session"
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          Both <span className="font-mono-tabular text-foreground">GNS</span> and{" "}
          <span className="font-mono-tabular text-foreground">INS</span> CSVs are required
          to align telemetry with GPS.
        </p>
      </div>
    </div>
  );
}
