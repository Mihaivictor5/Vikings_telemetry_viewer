import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Lap, TelemetryDataset, TelemetrySample } from "@/lib/telemetry/types";
import { fuseImuGps } from "@/lib/telemetry/fusion";

interface Props {
  ds: TelemetryDataset;
  laps: Lap[];
  selectedLap: number | null;
  cursorTs: number | null;
  startLine?: { lat: number; lon: number };
  onSetStartLine?: (p: { lat: number; lon: number }) => void;
  startLinePickMode: boolean;
  /** Which coord source */
  source: "INS" | "GNSS" | "FUSED";
  /** Color the full path by altitude (insAlt) when available. */
  colorByAltitude?: boolean;
}

export function TrackMap({
  ds,
  laps,
  selectedLap,
  cursorTs,
  startLine,
  onSetStartLine,
  startLinePickMode,
  source,
  colorByAltitude = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const fullPathRef = useRef<L.Polyline | null>(null);
  const altLayerRef = useRef<L.LayerGroup | null>(null);
  const lapPathRef = useRef<L.Polyline | null>(null);
  const carMarkerRef = useRef<L.CircleMarker | null>(null);
  const startMarkerRef = useRef<L.Marker | null>(null);

  // Altitude channel key (always from INS regardless of map source).
  const altKey = useMemo(
    () => ds.channels.find((c) => c.source === "gINS.input.insPosAlt")?.key,
    [ds]
  );

  // For FUSED mode we synthesize a samples array from the IMU+GPS fusion.
  // Otherwise we just look up channels on the original samples.
  const { effectiveSamples, latKey, lonKey } = useMemo(() => {
    if (source === "FUSED") {
      const gnssLat = ds.channels.find(c => c.source === "gINS.input.gnssPosLat")?.key;
      const gnssLon = ds.channels.find(c => c.source === "gINS.input.gnssPosLon")?.key;
      const velX = ds.channels.find(c => c.source === "gINS.input.velX")?.key;
      const velY = ds.channels.find(c => c.source === "gINS.input.velY")?.key;
      if (!gnssLat || !gnssLon || !velX || !velY) {
        return { effectiveSamples: ds.samples, latKey: undefined, lonKey: undefined };
      }
      const fused = fuseImuGps(ds.samples, { gnssLat, gnssLon, velX, velY });
      // Build an index mapping ts -> fused lat/lon, then synthesize samples
      // that align 1:1 with the original (so lap indices still work).
      const lk = "__fusedLat";
      const lnk = "__fusedLon";
      const map = new Map<number, { lat: number; lon: number }>();
      for (const p of fused) map.set(p.ts, p);
      let last: { lat: number; lon: number } | null = null;
      const synth: TelemetrySample[] = ds.samples.map((s) => {
        const p = map.get(s.ts) ?? last;
        if (p) last = p;
        return {
          ...s,
          v: { ...s.v, [lk]: p?.lat ?? NaN, [lnk]: p?.lon ?? NaN },
        };
      });
      return { effectiveSamples: synth, latKey: lk, lonKey: lnk };
    }
    const lk = source === "INS" ? ds.latKey : ds.channels.find(c => c.source === "gINS.input.gnssPosLat")?.key;
    const lnk = source === "INS" ? ds.lonKey : ds.channels.find(c => c.source === "gINS.input.gnssPosLon")?.key;
    return { effectiveSamples: ds.samples, latKey: lk, lonKey: lnk };
  }, [ds, source]);

  // Build the track as multiple segments. We split whenever the GPS sample
  // is invalid (NaN / zero) or when consecutive samples jump more than a sane
  // distance — this prevents stray "lines to infinity" from brief GNSS glitches.
  const segments = useMemo(() => {
    if (!latKey || !lonKey) return [] as L.LatLngTuple[][];
    return buildSegments(effectiveSamples, latKey, lonKey);
  }, [effectiveSamples, latKey, lonKey]);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      preferCanvas: false,
      zoomControl: true,
      attributionControl: true,
    }).setView([0, 0], 2);

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 20,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      }
    ).addTo(map);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Click handler for start-line picking
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      if (!startLinePickMode || !onSetStartLine) return;
      onSetStartLine({ lat: e.latlng.lat, lon: e.latlng.lng });
    };
    map.on("click", onClick);
    map.getContainer().style.cursor = startLinePickMode ? "crosshair" : "";
    return () => {
      map.off("click", onClick);
    };
  }, [startLinePickMode, onSetStartLine]);

  // Compute altitude range for the gradient legend / coloring.
  const altRange = useMemo(() => {
    if (!altKey) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const s of effectiveSamples) {
      const a = s.v[altKey];
      if (Number.isFinite(a)) {
        if (a < min) min = a;
        if (a > max) max = a;
      }
    }
    if (!Number.isFinite(min) || max - min < 0.1) return null;
    return { min, max };
  }, [effectiveSamples, altKey]);

  // Draw full path. When colorByAltitude is enabled and altitude data exists,
  // we draw many short polyline segments tinted by their average altitude.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Cleanup previous
    if (fullPathRef.current) {
      try { fullPathRef.current.remove(); } catch { /* noop */ }
      fullPathRef.current = null;
    }
    if (altLayerRef.current) {
      try { altLayerRef.current.remove(); } catch { /* noop */ }
      altLayerRef.current = null;
    }
    if (segments.length === 0) return;

    let bounds: L.LatLngBounds | null = null;
    if (colorByAltitude && altRange && altKey && latKey && lonKey) {
      // Build colored micro-segments per pair of consecutive valid points.
      const group = L.layerGroup().addTo(map);
      altLayerRef.current = group;
      let allBounds: L.LatLngBounds | null = null;
      for (let i = 0; i < effectiveSamples.length - 1; i++) {
        const a = effectiveSamples[i];
        const b = effectiveSamples[i + 1];
        if (!a || !b) continue;
        const aLat = a.v[latKey], aLon = a.v[lonKey];
        const bLat = b.v[latKey], bLon = b.v[lonKey];
        if (!isValidCoord(aLat, aLon) || !isValidCoord(bLat, bLon)) continue;
        const p1: L.LatLngTuple = [aLat, aLon];
        const p2: L.LatLngTuple = [bLat, bLon];
        if (haversineMeters(p1, p2) > MAX_JUMP_M) continue;
        const altA = a.v[altKey];
        const altB = b.v[altKey];
        const alt = Number.isFinite(altA) && Number.isFinite(altB)
          ? (altA + altB) / 2
          : Number.isFinite(altA) ? altA : altB;
        if (!Number.isFinite(alt)) continue;
        const t = (alt - altRange.min) / (altRange.max - altRange.min);
        const seg = L.polyline([p1, p2], {
          color: altitudeColor(t),
          weight: 2.5,
          opacity: 0.9,
          renderer: L.svg(),
        });
        seg.addTo(group);
        const segB = seg.getBounds();
        allBounds = allBounds ? allBounds.extend(segB) : segB;
      }
      bounds = allBounds;
    } else {
      const poly = L.polyline(segments, {
        color: "hsl(265, 70%, 65%)",
        weight: 2,
        opacity: 0.55,
        renderer: L.svg(),
      }).addTo(map);
      fullPathRef.current = poly;
      bounds = poly.getBounds();
    }
    if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
    return () => {
      if (fullPathRef.current) {
        try { fullPathRef.current.remove(); } catch { /* noop */ }
        fullPathRef.current = null;
      }
      if (altLayerRef.current) {
        try { altLayerRef.current.remove(); } catch { /* noop */ }
        altLayerRef.current = null;
      }
    };
  }, [segments, colorByAltitude, altRange, altKey, latKey, lonKey, effectiveSamples]);

  // Highlight selected lap
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lapPathRef.current) {
      try { lapPathRef.current.remove(); } catch { /* noop */ }
      lapPathRef.current = null;
    }
    if (selectedLap == null || !latKey || !lonKey) return;
    const lap = laps.find((l) => l.index === selectedLap);
    if (!lap) return;
    const lapSegs = buildSegments(effectiveSamples, latKey, lonKey, lap.startIdx, lap.endIdx);
    if (lapSegs.length === 0) return;
    const poly = L.polyline(lapSegs, {
      color: "hsl(45, 100%, 55%)",
      weight: 3.5,
      opacity: 1,
      renderer: L.svg(),
    }).addTo(map);
    lapPathRef.current = poly;
    return () => {
      try { poly.remove(); } catch { /* noop */ }
      if (lapPathRef.current === poly) lapPathRef.current = null;
    };
  }, [selectedLap, laps, effectiveSamples, latKey, lonKey]);

  // Car cursor
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !latKey || !lonKey) return;
    if (cursorTs == null) {
      carMarkerRef.current?.remove();
      carMarkerRef.current = null;
      return;
    }
    // binary search
    let lo = 0, hi = effectiveSamples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (effectiveSamples[mid].ts < cursorTs) lo = mid + 1;
      else hi = mid;
    }
    const s = effectiveSamples[lo];
    const lat = s?.v[latKey];
    const lon = s?.v[lonKey];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!carMarkerRef.current) {
      carMarkerRef.current = L.circleMarker([lat, lon], {
        radius: 6,
        color: "hsl(0, 0%, 100%)",
        fillColor: "hsl(45, 100%, 55%)",
        fillOpacity: 1,
        weight: 2,
      }).addTo(map);
    } else {
      carMarkerRef.current.setLatLng([lat, lon]);
    }
  }, [cursorTs, effectiveSamples, latKey, lonKey]);

  // Start line marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    startMarkerRef.current?.remove();
    startMarkerRef.current = null;
    if (!startLine) return;
    const icon = L.divIcon({
      className: "",
      html: `<div style="width:14px;height:14px;border-radius:50%;background:hsl(140,70%,55%);border:2px solid white;box-shadow:0 0 0 2px hsl(140,70%,55%,0.3)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    startMarkerRef.current = L.marker([startLine.lat, startLine.lon], { icon }).addTo(map);
  }, [startLine]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0 rounded-md" />
      {startLinePickMode && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[400] -translate-x-1/2 rounded-md border border-primary bg-popover/90 px-3 py-1.5 text-xs text-primary backdrop-blur">
          Click on the map to set start/finish line
        </div>
      )}
      {colorByAltitude && altRange && (
        <div className="pointer-events-none absolute bottom-2 right-2 z-[400] flex items-center gap-2 rounded-sm border border-border bg-popover/85 px-2 py-1 font-mono-tabular text-[10px] text-muted-foreground backdrop-blur">
          <span className="text-foreground">{altRange.min.toFixed(0)}m</span>
          <div
            className="h-2 w-24 rounded-sm"
            style={{
              background:
                "linear-gradient(to right, hsl(220,80%,55%), hsl(180,70%,55%), hsl(120,70%,55%), hsl(45,100%,55%), hsl(15,90%,55%))",
            }}
          />
          <span className="text-foreground">{altRange.max.toFixed(0)}m</span>
          <span className="ml-1 uppercase tracking-widest">alt</span>
        </div>
      )}
    </div>
  );
}

/** Map t in [0,1] to a perceptually-OK altitude color (blue → cyan → green → gold → orange). */
function altitudeColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  // 5 stops: blue, cyan, green, gold, orange
  const stops = [
    { h: 220, s: 80, l: 55 },
    { h: 180, s: 70, l: 55 },
    { h: 120, s: 70, l: 55 },
    { h: 45, s: 100, l: 55 },
    { h: 15, s: 90, l: 55 },
  ];
  const idx = x * (stops.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;
  const a = stops[i];
  const b = stops[Math.min(stops.length - 1, i + 1)];
  // Hue can wrap, but our hues all in same direction so plain lerp is fine here.
  const h = a.h + (b.h - a.h) * f;
  const s = a.s + (b.s - a.s) * f;
  const l = a.l + (b.l - a.l) * f;
  return `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
}

// Maximum reasonable distance (meters) between two consecutive samples.
// Logger runs at ~50 Hz; even at 200 km/h that's ~1.1 m/sample. 50 m is a
// generous threshold that still cuts off any GNSS jump glitch.
const MAX_JUMP_M = 50;

function haversineMeters(a: L.LatLngTuple, b: L.LatLngTuple): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function isValidCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat !== 0 &&
    lon !== 0 &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

/**
 * Build polyline segments from telemetry samples, breaking the line when a
 * sample is invalid or jumps more than MAX_JUMP_M from the previous one.
 * Leaflet renders an array of arrays as multiple disconnected segments.
 */
function buildSegments(
  samples: TelemetrySample[],
  latKey: string,
  lonKey: string,
  startIdx = 0,
  endIdx = samples.length - 1
): L.LatLngTuple[][] {
  const segments: L.LatLngTuple[][] = [];
  let current: L.LatLngTuple[] = [];
  let prev: L.LatLngTuple | null = null;

  const flush = () => {
    if (current.length >= 2) segments.push(current);
    current = [];
  };

  for (let i = startIdx; i <= endIdx; i++) {
    const s = samples[i];
    if (!s) continue;
    const lat = s.v[latKey];
    const lon = s.v[lonKey];
    if (!isValidCoord(lat, lon)) {
      flush();
      prev = null;
      continue;
    }
    const pt: L.LatLngTuple = [lat, lon];
    if (prev && haversineMeters(prev, pt) > MAX_JUMP_M) {
      flush();
    }
    current.push(pt);
    prev = pt;
  }
  flush();
  return segments;
}
