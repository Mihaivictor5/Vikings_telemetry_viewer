import Papa from "papaparse";
import { buildChannelDefs } from "./channels";
import { ChannelDef, TelemetryDataset, TelemetrySample } from "./types";

// Parse Vikings telemetry CSV.
// Quirks:
//  - First line is "sep=;"
//  - A few blank lines, then a header row
//  - Decimal separator is comma
//  - Timestamp format: "YYYY MM DD HH:MM:SS:mmm"

function parseTimestamp(s: string): number {
  // "2025 10 11 13:41:13:479"
  const m = s.trim().match(/^(\d{4})\s+(\d{2})\s+(\d{2})\s+(\d{2}):(\d{2}):(\d{2}):(\d{3})$/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, se, ms] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +se, +ms);
}

function toNumber(v: string): number {
  if (v == null) return NaN;
  const s = v.trim();
  if (!s) return NaN;
  // comma decimal -> dot
  return parseFloat(s.replace(/,/g, "."));
}

interface ParsedFile {
  channels: ChannelDef[];
  rows: Array<{ t: number; values: Record<string, number> }>;
}

async function parseFile(file: File, kind: "GNS" | "INS"): Promise<ParsedFile> {
  const text = await file.text();
  // Strip "sep=;" preamble + blank lines until we find header
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("Timestamp;")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) throw new Error(`${kind}: header row not found`);

  const cleaned = lines.slice(headerIdx).join("\n");
  const result = Papa.parse<string[]>(cleaned, {
    delimiter: ";",
    skipEmptyLines: true,
  });
  const data = result.data;
  if (data.length < 2) throw new Error(`${kind}: no data rows`);

  const header = data[0];
  // Trailing semicolon in source may add an empty last column — drop empties
  const cols = header.map((h) => h.trim()).filter((h) => h.length > 0);
  const sourceCols = cols.slice(1); // exclude Timestamp
  const channels = buildChannelDefs(kind, sourceCols);

  // Map source col name -> channel key
  const colKey = new Map<string, string>();
  for (const c of channels) colKey.set(c.source, c.key);

  const rows: ParsedFile["rows"] = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (!row || !row[0]) continue;
    const t = parseTimestamp(row[0]);
    if (!Number.isFinite(t)) continue;
    const values: Record<string, number> = {};
    for (let c = 1; c < cols.length; c++) {
      const key = colKey.get(cols[c]);
      if (!key) continue;
      values[key] = toNumber(row[c]);
    }
    rows.push({ t, values });
  }
  return { channels, rows };
}

/**
 * Merge two timestamped streams onto a single timeline.
 * Strategy: for each unique timestamp, hold last-known values from each stream.
 */
function mergeStreams(
  gns: ParsedFile,
  ins: ParsedFile
): { samples: TelemetrySample[]; channels: ChannelDef[] } {
  const channels = [...gns.channels, ...ins.channels];

  // Build a sorted union of all timestamps
  type TaggedRow = { t: number; src: "g" | "i"; values: Record<string, number> };
  const all: TaggedRow[] = [];
  for (const r of gns.rows) all.push({ t: r.t, src: "g", values: r.values });
  for (const r of ins.rows) all.push({ t: r.t, src: "i", values: r.values });
  all.sort((a, b) => a.t - b.t);

  if (all.length === 0) return { samples: [], channels };

  const t0 = all[0].t;
  const samples: TelemetrySample[] = [];
  const last: Record<string, number> = {};

  let cur = all[0].t;
  let curValues: Record<string, number> = {};

  const flush = () => {
    samples.push({
      t: cur,
      ts: (cur - t0) / 1000,
      v: { ...last, ...curValues },
    });
    Object.assign(last, curValues);
    curValues = {};
  };

  for (const row of all) {
    if (row.t !== cur) {
      flush();
      cur = row.t;
    }
    Object.assign(curValues, row.values);
  }
  flush();

  return { samples, channels };
}

export async function parseTelemetryFiles(
  gnsFile: File,
  insFile: File
): Promise<TelemetryDataset> {
  const [gns, ins] = await Promise.all([
    parseFile(gnsFile, "GNS"),
    parseFile(insFile, "INS"),
  ]);
  const { samples, channels } = mergeStreams(gns, ins);
  if (samples.length === 0) throw new Error("No samples parsed.");

  // Locate special channels
  const findKey = (src: string) => channels.find((c) => c.source === src)?.key;
  const latKey = findKey("gINS.input.insPosLat") ?? findKey("gINS.input.gnssPosLat");
  const lonKey = findKey("gINS.input.insPosLon") ?? findKey("gINS.input.gnssPosLon");
  const speedKey = findKey("gInverters.data.averageVelocityKmh");

  return {
    samples,
    channels,
    latKey,
    lonKey,
    speedKey,
    startTime: samples[0].t,
    endTime: samples[samples.length - 1].t,
    duration: samples[samples.length - 1].ts,
    fileNames: { gns: gnsFile.name, ins: insFile.name },
  };
}
