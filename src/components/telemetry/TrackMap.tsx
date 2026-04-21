import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Lap, TelemetryDataset } from "@/lib/telemetry/types";

interface Props {
  ds: TelemetryDataset;
  laps: Lap[];
  selectedLap: number | null;
  cursorTs: number | null;
  startLine?: { lat: number; lon: number };
  onSetStartLine?: (p: { lat: number; lon: number }) => void;
  startLinePickMode: boolean;
  /** Which coord source */
  source: "INS" | "GNSS";
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

  const latKey = source === "INS" ? ds.latKey : ds.channels.find(c => c.source === "gINS.input.gnssPosLat")?.key;
  const lonKey = source === "INS" ? ds.lonKey : ds.channels.find(c => c.source === "gINS.input.gnssPosLon")?.key;

  // Build the track as multiple segments. We split whenever the GPS sample
  // is invalid (NaN / zero) or when consecutive samples jump more than a sane
  // distance — this prevents stray "lines to infinity" from brief GNSS glitches.
  const segments = useMemo(() => {
    if (!latKey || !lonKey) return [] as L.LatLngTuple[][];
    return buildSegments(ds.samples, latKey, lonKey);
  }, [ds, latKey, lonKey]);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      preferCanvas: true,
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
    fullPathRef.current?.remove();
    if (segments.length === 0) return;
    const poly = L.polyline(segments, {
      color: "hsl(200, 95%, 60%)",
      weight: 2,
      opacity: 0.55,
    }).addTo(map);
    fullPathRef.current = poly;
    const bounds = poly.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
  }, [segments]);

  // Highlight selected lap
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    lapPathRef.current?.remove();
    lapPathRef.current = null;
    if (selectedLap == null || !latKey || !lonKey) return;
    const lap = laps.find((l) => l.index === selectedLap);
    if (!lap) return;
    const lapSegs = buildSegments(ds.samples, latKey, lonKey, lap.startIdx, lap.endIdx);
    if (lapSegs.length > 0) {
      lapPathRef.current = L.polyline(lapSegs, {
        color: "hsl(50, 95%, 60%)",
        weight: 3.5,
        opacity: 1,
      }).addTo(map);
    }
  }, [selectedLap, laps, ds, latKey, lonKey]);

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
    let lo = 0, hi = ds.samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ds.samples[mid].ts < cursorTs) lo = mid + 1;
      else hi = mid;
    }
    const s = ds.samples[lo];
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
  }, [cursorTs, ds, latKey, lonKey]);

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
