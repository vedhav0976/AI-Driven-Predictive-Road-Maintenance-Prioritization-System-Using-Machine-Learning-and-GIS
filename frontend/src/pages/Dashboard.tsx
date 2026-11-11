import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, ClipboardCheck, RefreshCw } from "lucide-react";
import { apiFetch, type DashboardData } from "../api";

type Priority = "High" | "Medium" | "Low";

const PRIORITIES: Priority[] = ["High", "Medium", "Low"];
const PRIORITY_COLORS: Record<Priority, string> = {
  High: "#dc2626",
  Medium: "#f59e0b",
  Low: "#16a34a",
};

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [damageType, setDamageType] = useState("All");

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<DashboardData>("/api/dashboard", { signal: controller.signal })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "The dashboard could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const interval = window.setInterval(() => setRefreshKey((key) => key + 1), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const categoryRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data?.history ?? []) {
      counts.set(item.damage_type, (counts.get(item.damage_type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);
  const history = useMemo(() => (data?.history ?? []).filter((item) =>
    damageType === "All" || item.damage_type === damageType,
  ), [damageType, data]);
  const priorityCounts = data?.priority_distribution;
  const priorityTotal = PRIORITIES.reduce((total, priority) => total + (priorityCounts?.[priority] ?? 0), 0);
  const refresh = () => {
    setRefreshing(true);
    setRefreshKey((key) => key + 1);
  };

  return <div className="dashboard-page">
    <section className="page-hero"><div><p className="eyebrow">ENGINEERING DASHBOARD</p><h1>Road damage observations</h1><p>Saved image analyses, approximate GIS matches, and optional Mapillary files. Data refreshes every 30 seconds.</p></div></section>
    <div className="dashboard-source-row">
      <span>{loading ? "Connecting to backend…" : error ? "Backend unavailable" : "Source: backend uploads and Mapillary files"}</span>
      <button className="panel-action" type="button" onClick={refresh} disabled={refreshing}><RefreshCw size={16} />{refreshing ? "Refreshing…" : "Refresh"}</button>
    </div>
    {error && <div className="map-notice"><AlertTriangle size={18} /><span>Could not reach the dashboard API: {error}. Check the API address or try again later.</span></div>}
    {!data && !loading && <div className="empty-state"><ClipboardCheck size={28} /><h3>No backend data loaded</h3><p>The dashboard will show observations when the API is available.</p></div>}
    {data && <>
      <div className="map-notice"><ClipboardCheck size={18} /><span>{data.uploaded_images} uploaded image{data.uploaded_images === 1 ? "" : "s"} analyzed; {data.images_processed - data.uploaded_images} optional Mapillary metadata record{data.images_processed - data.uploaded_images === 1 ? "" : "s"} loaded. Road Map and Road Assessment show saved API results.{data.uploaded_images > 0 && data.detections === 0 ? " No road damage was detected in the saved analyses." : ""}</span></div>
      <section className="presentation-stat-grid">
        <Stat label="Images recorded" value={String(data.images_processed)} detail={`${data.uploaded_images} analyzed uploads; ${data.images_processed - data.uploaded_images} Mapillary metadata`} />
        <Stat label="Damage detections" value={String(data.detections)} detail="Saved YOLO detections" />
        <Stat label="Geolocated" value={String(data.geolocated_observations)} detail="Detections with coordinates" />
        <Stat label="Road segments" value={String(data.road_segments)} detail="Approximate GeoJSON matches" />
      </section>
      <section className="dashboard-grid dashboard-summary-grid">
        <div className="panel"><div className="panel-header"><div><p className="panel-kicker">PROTOTYPE PRIORITY</p><h2>Scored road segments</h2></div><BarChart3 size={21} /></div><div className="chart-list">{PRIORITIES.map((priority) => <ChartRow key={priority} label={priority} value={priorityCounts?.[priority] ?? 0} total={priorityTotal} color={PRIORITY_COLORS[priority]} />)}{!priorityTotal && <p className="muted-text">No GPS-matched, scored road segments yet.</p>}</div></div>
        <div className="panel"><div className="panel-header"><div><p className="panel-kicker">DETECTED DAMAGE</p><h2>Damage profile</h2></div><ClipboardCheck size={21} /></div><div className="chart-list">{categoryRows.map(([label, value]) => <ChartRow key={label} label={label} value={value} total={data.detections} color="#477ba8" />)}{!categoryRows.length && <p className="muted-text">No saved damage categories available.</p>}</div></div>
      </section>
      <section className="panel dashboard-recent-panel"><div className="panel-header"><div><p className="panel-kicker">UPLOAD HISTORY</p><h2>Recent analyses</h2></div><span className="muted-text">{data.recent_uploads.length} shown</span></div>
        {data.recent_uploads.length ? <div className="table-wrapper"><table className="metrics-table"><thead><tr><th>Image</th><th>Detections</th><th>Road</th><th>PCI proxy</th><th>MPI proxy</th><th>Priority</th><th>Analyzed</th></tr></thead><tbody>{data.recent_uploads.map((item) => <tr key={item.id}><td>{item.filename}</td><td>{item.detection_count}</td><td>{item.road_id ?? (item.latitude == null ? "No GPS" : "Outside coverage")}</td><td>{item.pci_proxy?.toFixed(1) ?? "—"}</td><td>{item.mpi_proxy?.toFixed(1) ?? "—"}</td><td>{item.priority ?? "Unassessed"}</td><td>{new Date(item.created_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="empty-state"><ClipboardCheck size={28} /><h3>No uploads yet</h3><p>Run AI Damage Analysis to add an image to this history.</p></div>}
      </section>
      <section className="dashboard-grid lower-grid">
        <div className="panel queue-panel"><div className="panel-header"><div><p className="panel-kicker">SAVED OBSERVATIONS</p><h2>Detection history</h2></div><span className="muted-text">{history.length} shown</span></div>
          <div className="assessment-toolbar"><select value={damageType} onChange={(event) => setDamageType(event.target.value)} aria-label="Filter damage category"><option>All</option>{categoryRows.map(([label]) => <option key={label}>{label}</option>)}</select></div>
          <div className="table-wrapper"><table className="metrics-table"><thead><tr><th>Image</th><th>Damage</th><th>Confidence</th><th>Source</th><th>Location</th><th>Priority</th></tr></thead><tbody>{history.map((item, index) => <tr key={`${item.filename}-${index}`}><td>{item.filename || "Unknown image"}</td><td>{item.damage_type}</td><td>{(item.confidence * 100).toFixed(1)}%</td><td>{item.source === "uploaded_inference" ? "Uploaded analysis" : "Mapillary file"}</td><td>{item.location_status === "road_snapped" ? item.road_id : item.location_status === "geolocated_observation" ? "GPS (unmatched)" : item.location_status === "outside_road_coverage" ? "Outside coverage" : "No GPS"}</td><td>{item.priority ?? "—"}</td></tr>)}</tbody></table></div>
          {!history.length && <div className="empty-state"><ClipboardCheck size={28} /><h3>No saved observations</h3><p>{data.detections ? "Choose another damage category." : "Run AI analysis or add Mapillary detection data to populate this table."}</p></div>}
        </div>
        <div className="panel"><div className="panel-header"><div><p className="panel-kicker">MODEL EVIDENCE</p><h2>Backend status</h2></div></div><div className="priority-summary"><p>Model: {data.model.name} ({data.model.status})</p><p>Validation metrics: {data.model_metrics.reported ? "Training-reported" : data.model_metrics.available ? "Available from run CSV" : "Unavailable"}</p><p>Unmatched observations: {data.unmatched_observations}</p>{data.limitations.map((limitation) => <p key={limitation} className="muted-copy">{limitation}</p>)}</div></div>
      </section>
    </>}
  </div>;
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="presentation-stat"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function ChartRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  return <div className="chart-row"><div className="chart-row-label"><span>{label}</span><strong>{value}</strong></div><div className="chart-track"><i style={{ width: total ? `${(value / total) * 100}%` : "0%", backgroundColor: color }} /></div></div>;
}

export default Dashboard;
