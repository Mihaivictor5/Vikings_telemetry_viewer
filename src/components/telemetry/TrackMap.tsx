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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const fullPathRef = useRef<L.Polyline | null>(null);
  const lapPathRef = useRef<L.Polyline | null>(null);
  const carMarkerRef = useRef<L.CircleMarker | null>(null);
  const startMarkerRef = useRef<L.Marker | null>(null);

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

  // Draw full path
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (fullPathRef.current) {
      try { fullPathRef.current.remove(); } catch { /* noop */ }
      fullPathRef.current = null;
    }
    if (segments.length === 0) return;
    const poly = L.polyline(segments, {
      color: "hsl(200, 95%, 60%)",
      weight: 2,
      opacity: 0.55,
      renderer: L.svg(),
    }).addTo(map);
    fullPathRef.current = poly;
    const bounds = poly.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
    return () => {
      try { poly.remove(); } catch { /* noop */ }
      if (fullPathRef.current === poly) fullPathRef.current = null;
    };
  }, [segments]);

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
      color: "hsl(50, 95%, 60%)",
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
        fillColor: "hsl(350, 85%, 62%)",
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
    </div>
  );
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
