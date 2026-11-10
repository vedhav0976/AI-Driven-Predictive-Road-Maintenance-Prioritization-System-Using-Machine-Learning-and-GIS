import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { latLngBounds } from "leaflet";
import { AlertTriangle, MapPinned } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { apiFetch, type InspectionObservation, type PriorityMap } from "../api";

type Coordinate = [number, number];

function FitToResults({ coordinates }: { coordinates: Coordinate[] }) {
  const map = useMap();
  useEffect(() => {
    if (coordinates.length) map.fitBounds(latLngBounds(coordinates), { padding: [25, 25], maxZoom: 15 });
  }, [coordinates, map]);
  return null;
}

function RoadMap() {
  const [layer, setLayer] = useState<PriorityMap | null>(null);
  const [observations, setObservations] = useState<InspectionObservation[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => Promise.all([
      apiFetch<PriorityMap>("/api/map"),
      apiFetch<{ records: InspectionObservation[] }>("/api/observations?limit=200"),
    ]).then(([mapData, queue]) => {
      if (active) { setLayer(mapData); setObservations(queue.records); setError(null); }
    }).catch((reason: Error) => { if (active) setError(reason.message); });
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const coordinates = useMemo(() => [
    ...(layer?.features.flatMap((feature) => feature.geometry.coordinates.map(([lon, lat]): Coordinate => [lat, lon])) ?? []),
    ...observations.filter((item) => item.latitude != null && item.longitude != null)
      .map((item): Coordinate => [item.latitude!, item.longitude!]),
  ], [layer, observations]);
  const matched = layer?.features.filter((feature) => feature.properties.priority).length ?? 0;

  return <div className="content-page">
    <section className="section-heading"><div><p className="eyebrow">GIS WORKSPACE</p><h1>Bengaluru road map</h1><p>Saved GPS observations and scored local road segments. The layer refreshes every 30 seconds.</p></div><div className="map-location"><MapPinned size={17} /> Bengaluru, India</div></section>
    {error && <div className="map-notice"><AlertTriangle size={18} /><span>Map API unavailable: {error}</span></div>}
    {!error && <div className="map-notice"><MapPinned size={18} /><span>{matched ? `${matched} scored road segments` : "No scored road segments yet"}; {observations.filter((item) => item.geolocated).length} recent located uploads. GPS from EXIF or a visible image stamp appears as a point; road scoring requires a match within 30 m of the configured geometry.</span></div>}
    <section className="full-map-panel"><MapContainer center={[12.9716, 77.5946]} zoom={11} scrollWheelZoom className="leaflet-map"><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><FitToResults coordinates={coordinates} />
      {layer?.features.map((feature) => <Polyline key={feature.id} positions={feature.geometry.coordinates.map(([lon, lat]): Coordinate => [lat, lon])} pathOptions={{ color: feature.properties.color, weight: 6, opacity: 0.85 }}><Popup><strong>{feature.properties.road_name ?? feature.id}</strong><br />Segment: {feature.id}<br />Road class: {feature.properties.road_type ?? "Unknown"}<br />PCI proxy: {feature.properties.pci_score?.toFixed(1) ?? "Unassessed"}<br />MPI proxy: {feature.properties.mpi_score?.toFixed(1) ?? "Unassessed"}<br />Priority: {feature.properties.priority ?? "Unassessed"}</Popup></Polyline>)}
      {observations.filter((item) => item.latitude != null && item.longitude != null).map((item) => <CircleMarker key={item.id} center={[item.latitude!, item.longitude!]} radius={5} pathOptions={{ color: "#1d4ed8", fillColor: "#1d4ed8", fillOpacity: 0.8 }}><Popup><strong>{item.filename}</strong><br />{item.damage_types.join(", ") || "No scored damage"}<br />Location: {item.latitude?.toFixed(6)}, {item.longitude?.toFixed(6)} ({item.location_source === "image_overlay" ? "image overlay" : item.location_source === "manual" ? "entered" : "EXIF"})<br />Image priority proxy: {item.priority ?? "Unassessed"}<br />{item.road_id ? `Matched: ${item.road_id}` : "Outside available road geometry"}</Popup></CircleMarker>)}
    </MapContainer></section>
    <div className="map-legend"><div><span className="legend-line" style={{ backgroundColor: "#EF4444" }} /><span>High priority</span></div><div><span className="legend-line" style={{ backgroundColor: "#F59E0B" }} /><span>Medium priority</span></div><div><span className="legend-line" style={{ backgroundColor: "#10B981" }} /><span>Low priority</span></div><div><span className="legend-line" style={{ backgroundColor: "#1d4ed8" }} /><span>Uploaded image location</span></div></div>
  </div>;
}

export default RoadMap;
