import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { latLngBounds } from "leaflet";
import { AlertTriangle, MapPinned } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { loadSimulatedDetections, type SimulatedDetection } from "../data/simulatedYoloData";
import { PRIORITY_COLORS } from "../data/roadMarkerData";

type Coordinate = [number, number];

function FitToObservations({ coordinates }: { coordinates: Coordinate[] }) {
  const map = useMap();
  useEffect(() => {
    if (coordinates.length > 1) map.fitBounds(latLngBounds(coordinates), { padding: [25, 25], maxZoom: 15 });
  }, [coordinates, map]);
  return null;
}

function RoadMap() {
  const [markers, setMarkers] = useState<SimulatedDetection[]>([]);
  const [roadError, setRoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadSimulatedDetections(controller.signal)
      .then(setMarkers)
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setRoadError(reason.message);
      });
    return () => controller.abort();
  }, []);

  const coordinates = useMemo(() => markers.map((item): Coordinate => [item.latitude, item.longitude]), [markers]);

  return <div className="content-page">
    <section className="section-heading"><div><p className="eyebrow">GIS WORKSPACE</p><h1>Bengaluru road map</h1><p>Road-priority markers sampled directly from the available local road geometry.</p></div><div className="map-location"><MapPinned size={17} /> Bengaluru, India</div></section>
    {roadError && <div className="map-notice"><AlertTriangle size={18} /><span>{roadError}</span></div>}
    <section className="full-map-panel"><MapContainer center={[12.9716, 77.5946]} zoom={11} scrollWheelZoom className="leaflet-map"><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><FitToObservations coordinates={coordinates} />
      {markers.map((item) => <CircleMarker key={item.id} center={[item.latitude, item.longitude]} pathOptions={{ color: PRIORITY_COLORS[item.priority], fillColor: PRIORITY_COLORS[item.priority], fillOpacity: 0.82, weight: 1.5 }} radius={5}><Popup><strong>{item.id}</strong><br />Road: {item.roadName}<br />Road segment: {item.roadSegmentId}<br />Area: {item.area}<br />Damage category: {item.damageType}<br />Confidence: {(item.confidence * 100).toFixed(1)}%<br />Severity: {item.severity}<br />Priority: {item.priority}<br />Action: {item.recommendedAction}<br /><small>Source: Simulated detection data ({item.source}); not genuine YOLO inference.</small></Popup></CircleMarker>)}
    </MapContainer></section>
    <div className="map-legend"><div><span className="legend-line" style={{ backgroundColor: PRIORITY_COLORS.High }} /><span>High priority · 80</span></div><div><span className="legend-line" style={{ backgroundColor: PRIORITY_COLORS.Medium }} /><span>Medium priority · 160</span></div><div><span className="legend-line" style={{ backgroundColor: PRIORITY_COLORS.Low }} /><span>Low priority · 200</span></div></div>
  </div>;
}

export default RoadMap;
