import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { latLngBounds } from "leaflet";
import { AlertTriangle, ArrowUpRight, MapPinned, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import { apiFetch, type InspectionObservation, type PriorityMap } from "../api";

type Coordinate = [number, number];
type RoadGeometry = PriorityMap["features"][number]["geometry"];
type BaseRoad = { id: string; geometry: RoadGeometry };

function roadPaths(geometry: RoadGeometry): Coordinate[][] {
  const lines = geometry.type === "MultiLineString" ? geometry.coordinates : [geometry.coordinates];
  return lines.map((line) => line.map(([lon, lat]): Coordinate => [lat, lon]));
}

const PRIORITY_COLORS = { High: "#dc2626", Medium: "#f59e0b", Low: "#2563eb", Unassessed: "#64748b" } as const;

function attributionLink(value: string | null | undefined, hosts: string[], fallback: string): string {
  try {
    const url = new URL(value ?? "");
    if (url.protocol === "https:" && hosts.includes(url.hostname) && !url.username && !url.password) return url.href;
  } catch { /* Use a canonical attribution URL when source metadata is incomplete. */ }
  return fallback;
}

function MapillaryAttribution({ source }: { source: NonNullable<InspectionObservation["source_metadata"]> }) {
  const imageUrl = attributionLink(source.image_url, ["mapillary.com", "www.mapillary.com"], `https://www.mapillary.com/app/?pKey=${encodeURIComponent(source.image_id)}`);
  const creatorUrl = attributionLink(source.creator_url, ["mapillary.com", "www.mapillary.com"], imageUrl);
  const licenseUrl = attributionLink(source.license_url, ["creativecommons.org", "www.creativecommons.org"], "https://creativecommons.org/licenses/by-sa/4.0/");
  const captureDate = source.captured_at == null ? null : new Date(source.captured_at);
  return <p>Photo: <a href={imageUrl} target="_blank" rel="noopener noreferrer">Mapillary #{source.image_id}</a><br />Creator: <a href={creatorUrl} target="_blank" rel="noopener noreferrer">{source.creator_username ?? source.creator_id ?? "View photo credits"}</a>{" · "}<a href={licenseUrl} target="_blank" rel="noopener noreferrer">{source.license}</a><br />Captured: {captureDate && !Number.isNaN(captureDate.getTime()) ? captureDate.toLocaleString() : "Not supplied"}</p>;
}

function FitToResults({ coordinates }: { coordinates: Coordinate[] }) {
  const map = useMap();
  const previousBounds = useRef("");
  useEffect(() => {
    const signature = JSON.stringify(coordinates);
    if (coordinates.length && signature !== previousBounds.current) {
      map.fitBounds(latLngBounds(coordinates), { padding: [35, 35], maxZoom: 15 });
      previousBounds.current = signature;
    }
  }, [coordinates, map]);
  return null;
}

function ResizeMap() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

function RoadMap() {
  const [baseRoads, setBaseRoads] = useState<BaseRoad[]>([]);
  const [layer, setLayer] = useState<PriorityMap | null>(null);
  const [observations, setObservations] = useState<InspectionObservation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const lastRefresh = useRef(0);

  useEffect(() => {
    lastRefresh.current = Date.now();
    const refreshOnReturn = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastRefresh.current < 2000) return;
      lastRefresh.current = Date.now();
      setRefreshKey((key) => key + 1);
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/bengaluru-roads.geojson", { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Road geometry could not be loaded."); return response.json(); })
      .then((data: { features?: BaseRoad[] }) => setBaseRoads(data.features ?? []))
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      apiFetch<PriorityMap>("/api/map", { cache: "no-store" }),
      apiFetch<{ records: InspectionObservation[] }>("/api/observations?limit=200", { cache: "no-store" }),
    ]).then(([mapResult, observationResult]) => {
      if (!active) return;
      setLayer(mapResult.status === "fulfilled" ? mapResult.value : null);
      setObservations(observationResult.status === "fulfilled" ? observationResult.value.records : []);
      if (mapResult.status === "rejected" || observationResult.status === "rejected") setError("Some live observations are unavailable. The local road map remains visible.");
      else setError(null);
      setLoading(false);
    });
    return () => { active = false; };
  }, [refreshKey]);

  const locatedObservations = useMemo(() => observations.filter((item) => item.latitude != null && item.longitude != null), [observations]);
  const coordinates = useMemo(() => baseRoads.flatMap((feature) => roadPaths(feature.geometry).flat()), [baseRoads]);
  const matched = layer?.features.filter((feature) => feature.properties.priority).length ?? 0;

  return <div className="content-page">
    <section className="section-heading"><div><p className="eyebrow">SPATIAL INTELLIGENCE</p><h1>Road condition map</h1><p>See where damage was observed and explore maintenance priorities by road.</p></div><div className="page-actions"><Link className="button-secondary" to="/road-assessment">Review assessments<ArrowUpRight size={16} /></Link><Link className="button-primary" to="/ai-analysis">Add an analysis<ArrowUpRight size={16} /></Link></div></section>
    {error && <div className="map-notice" role="alert"><AlertTriangle size={18} /><span>We could not refresh the map data. {error}</span></div>}
    <div className="map-summary-bar"><span className="map-location"><MapPinned size={17} />Bengaluru road coverage</span><span><strong>{matched}</strong> scored road segments</span><span><strong>{locatedObservations.length}</strong> located images</span><span className="status-badge ready">{loading ? "Loading observations…" : "Road map ready"}</span><button className="panel-action" type="button" onClick={() => { setLoading(true); setRefreshKey((key) => key + 1); }} disabled={loading}><RefreshCw size={15} />Refresh map data</button></div>
    <section className="full-map-panel" aria-label="Road observations map"><MapContainer center={[12.976, 77.617]} zoom={14} scrollWheelZoom className="leaflet-map"><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><ResizeMap /><FitToResults coordinates={coordinates} />
      {baseRoads.map((feature) => <Polyline key={feature.id} positions={roadPaths(feature.geometry)} pathOptions={{ color: "#64748b", weight: 3, opacity: 0.65 }} />)}
      {layer?.features.filter((feature) => feature.properties.priority).map((feature) => <Polyline key={feature.id} positions={roadPaths(feature.geometry)} pathOptions={{ color: feature.properties.color, weight: 6, opacity: 0.85 }}><Popup><strong>{feature.properties.road_name ?? feature.id}</strong><br />Road ID: {feature.id}<br />Road hierarchy: {feature.properties.road_type ?? "Unknown"}<br />{feature.properties.near_critical_facility && <><strong>Critical facility nearby: {feature.properties.critical_facility_name ?? "Yes"} (+20% criticality)</strong><br /></>}Current PCI: {feature.properties.pci_score?.toFixed(1) ?? "Unassessed"}<br />MPI (0–100): {feature.properties.mpi_score?.toFixed(1) ?? "Unassessed"}<br />60-day projected PCI: {feature.properties.projected_pci_60d?.toFixed(1) ?? "—"}<br />Days to critical: {feature.properties.days_to_critical ?? "—"}<br />Priority: {feature.properties.priority ?? "Unassessed"}</Popup></Polyline>)}
      {locatedObservations.map((item) => {
        const color = PRIORITY_COLORS[item.priority ?? "Unassessed"];
        return <CircleMarker key={item.id} center={[item.latitude!, item.longitude!]} radius={7} pathOptions={{ color, fillColor: color, fillOpacity: 0.9, weight: 2 }}><Popup><strong>{item.filename}</strong><br />{item.damage_types.map((value) => value.replace(/^D\d+_/, "").replaceAll("_", " ")).join(", ") || "No scored damage"}<br />GPS: {item.latitude?.toFixed(6)}, {item.longitude?.toFixed(6)}<br />Source: {item.location_source === "mapillary" ? "Mapillary coordinates" : item.location_source === "image_overlay" ? "Image coordinate stamp" : item.location_source === "manual" ? "Previously entered" : "EXIF metadata"}<br />Image priority proxy: {item.priority ?? "Unassessed"}<br />{item.road_id ? `Matched road: ${item.road_id}` : "Outside available road geometry"}{item.source_metadata?.provider === "mapillary" && <MapillaryAttribution source={item.source_metadata} />}</Popup></CircleMarker>;
      })}
    </MapContainer></section>
    <div className="map-legend"><div><span className="legend-line" style={{ backgroundColor: PRIORITY_COLORS.High }} /><span>High priority</span></div><div><span className="legend-line" style={{ backgroundColor: PRIORITY_COLORS.Medium }} /><span>Medium priority</span></div><div><span className="legend-line" style={{ backgroundColor: PRIORITY_COLORS.Low }} /><span>Low priority</span></div><div><span className="legend-line" style={{ backgroundColor: PRIORITY_COLORS.Unassessed }} /><span>Unassessed</span></div></div>
    {!loading && !error && !locatedObservations.length && <div className="data-note"><MapPinned size={18} /><span>No located images yet. Analyze a Mapillary image or a photo with EXIF GPS or a readable coordinate stamp to place it on the map.</span><Link className="panel-action" to="/ai-analysis">Analyze images<ArrowUpRight size={15} /></Link></div>}
    <details className="data-disclosure"><summary>Reading the map</summary><p>Points use the image assessment priority color; gray means unassessed. Colored road lines show visual priority proxies for matched damage observations. Images outside Bengaluru road coverage can still appear as points; a road line is scored only when a match is within 30 m of the available geometry.</p><p>The map includes up to 200 recent image observations. Select a point or road line to inspect its details.</p></details>
  </div>;
}

export default RoadMap;
