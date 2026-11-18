import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, BarChart3, BrainCircuit, ClipboardCheck, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { apiFetch, type DashboardData } from "../api";

type Priority = "High" | "Medium" | "Low";
const PRIORITIES: Priority[] = ["High", "Medium", "Low"];
const PRIORITY_COLORS: Record<Priority, string> = { High: "#dc2626", Medium: "#f59e0b", Low: "#2563eb" };
const DASHBOARD_TIMEOUT_MS = 20_000;
const damageLabel = (value: string) => value.replace(/^D\d+_/, "").replaceAll("_", " ");

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [damageType, setDamageType] = useState("All");

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DASHBOARD_TIMEOUT_MS);
    apiFetch<DashboardData>("/api/dashboard", { signal: controller.signal })
      .then((result) => { if (!disposed) { setData(result); setError(null); } })
      .catch((reason: unknown) => {
        if (disposed) return;
        setError(timedOut
          ? "The analysis service did not respond within 20 seconds. Please try again shortly."
          : reason instanceof Error ? reason.message : "The dashboard could not be loaded.");
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!disposed) { setLoading(false); setRefreshing(false); }
      });
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort(); };
  }, [refreshKey]);

  const categoryRows = useMemo(() => {
    return Object.entries(data?.damage_distribution ?? {}).sort((a, b) => b[1] - a[1]);
  }, [data]);
  const history = useMemo(() => (data?.history ?? []).filter((item) => damageType === "All" || item.damage_type === damageType), [damageType, data]);
  const priorityCounts = data?.priority_distribution;
  const priorityTotal = PRIORITIES.reduce((total, priority) => total + (priorityCounts?.[priority] ?? 0), 0);
  const refresh = () => { setRefreshing(true); setRefreshKey((key) => key + 1); };

  return <div className="dashboard-page">
    <section className="page-hero">
      <div><p className="eyebrow">NETWORK OVERVIEW</p><h1>A clearer view of your roads.</h1><p>Track visible damage, explore image locations, and plan the next inspection.</p></div>
      <div className="page-actions"><Link className="button-secondary" to="/road-map">Explore map<ArrowUpRight size={17} /></Link><Link className="button-primary" to="/ai-analysis"><BrainCircuit size={17} />Analyze images</Link></div>
    </section>
    <div className="dashboard-source-row">
      <span className={`status-badge ${loading ? "" : error ? "warning" : "ready"}`}>{loading ? "Connecting…" : error ? "Connection interrupted" : "Live data · refresh when needed"}</span>
      <button className="panel-action" type="button" onClick={refresh} disabled={loading || refreshing}><RefreshCw size={16} />{refreshing ? "Refreshing…" : "Refresh data"}</button>
    </div>
    {error && <div className="map-notice" role="alert"><AlertTriangle size={18} /><span>We could not refresh the dashboard. {error}{data ? " The last loaded results are still shown below." : " Try Refresh data to reconnect."}</span></div>}
    {!data && loading && <div className="loading-state" role="status"><span className="loading-spinner" />Loading your road network…</div>}
    {!data && !loading && <div className="empty-state"><ClipboardCheck size={28} /><h3>Your dashboard is waiting for a connection</h3><p>Saved analyses will appear here when the service is available.</p><button className="button-secondary" type="button" onClick={refresh}>Try again<RefreshCw size={16} /></button></div>}
    {data && <>
      <div className="data-note"><ClipboardCheck size={17} /><span>Based on {data.uploaded_images} saved image analys{data.uploaded_images === 1 ? "is" : "es"}{data.images_processed > data.uploaded_images ? ` and ${data.images_processed - data.uploaded_images} Mapillary metadata records` : ""}. Priority scores are visual proxies to support inspection planning.</span></div>
      <section className="presentation-stat-grid">
        <Stat label="Images recorded" value={String(data.images_processed)} detail={`${data.uploaded_images} saved analyses${data.images_processed > data.uploaded_images ? ` · ${data.images_processed - data.uploaded_images} Mapillary records` : ""}`} />
        <Stat label="Damage detections" value={String(data.detections)} detail="Saved YOLO detections" />
        <Stat label="Geolocated" value={String(data.geolocated_observations)} detail="Detections with coordinates" />
        <Stat label="Road segments" value={String(data.road_segments)} detail="Matched to available road geometry" />
      </section>
      <section className="dashboard-grid dashboard-summary-grid">
        <div className="panel"><div className="panel-header"><div><p className="panel-kicker">MAINTENANCE PRIORITY</p><h2>Saved analyses by priority</h2></div><BarChart3 size={21} /></div><div className="chart-list">{PRIORITIES.map((priority) => <Link key={priority} className="priority-chart-link" to={`/road-assessment?priority=${priority}`} aria-label={`View ${priority.toLowerCase()} priority assessments`}><ChartRow label={priority} value={priorityCounts?.[priority] ?? 0} total={priorityTotal} color={PRIORITY_COLORS[priority]} /></Link>)}{!priorityTotal && <p className="muted-text">Priorities appear after an analysis detects scored damage. GPS is needed to color a road on the map.</p>}</div></div>
        <div className="panel"><div className="panel-header"><div><p className="panel-kicker">DETECTED DAMAGE</p><h2>Damage profile</h2></div><ClipboardCheck size={21} /></div><div className="chart-list">{categoryRows.map(([label, value]) => <ChartRow key={label} label={damageLabel(label)} value={value} total={data.detections} color="#16806a" />)}{!categoryRows.length && <p className="muted-text">Damage categories will appear after an image analysis finds visible damage.</p>}</div></div>
      </section>
      <section className="panel dashboard-recent-panel">
        <div className="panel-header"><div><p className="panel-kicker">YOUR LATEST WORK</p><h2>Recent analyses</h2></div><Link className="panel-action" to="/history">View all history<ArrowUpRight size={16} /></Link></div>
        {data.recent_uploads.length ? <div className="table-wrapper"><table className="metrics-table"><thead><tr><th>Image</th><th>Detections</th><th>Road</th><th>PCI proxy</th><th>MPI proxy</th><th>Priority</th><th>Analyzed</th></tr></thead><tbody>{data.recent_uploads.map((item) => <tr key={item.id}><td><Link className="table-record-link" to={`/history/${item.id}`}>{item.filename}<ArrowUpRight size={13} /></Link></td><td>{item.detection_count}</td><td>{item.road_id ?? (item.latitude == null ? "No GPS" : "Outside coverage")}</td><td>{item.pci_proxy?.toFixed(1) ?? "—"}</td><td>{item.mpi_proxy?.toFixed(1) ?? "—"}</td><td>{item.priority ? <span className={`priority-pill ${item.priority.toLowerCase()}`}>{item.priority}</span> : <span className="muted-text">Unassessed</span>}</td><td>{new Date(item.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</td></tr>)}</tbody></table></div> : <div className="empty-state"><ClipboardCheck size={28} /><h3>Your first analysis starts here</h3><p>Upload a road image to build your inspection history.</p><Link className="button-primary" to="/ai-analysis">Analyze an image<ArrowUpRight size={16} /></Link></div>}
      </section>
      <section className="dashboard-grid lower-grid">
        <div className="panel queue-panel"><div className="panel-header"><div><p className="panel-kicker">SAVED OBSERVATIONS</p><h2>Detection history</h2></div><span className="muted-text">{history.length} shown</span></div>
          <div className="assessment-toolbar"><select value={damageType} onChange={(event) => setDamageType(event.target.value)} aria-label="Filter damage category"><option value="All">All damage types</option>{categoryRows.map(([label]) => <option key={label} value={label}>{damageLabel(label)}</option>)}</select></div>
          <div className="table-wrapper"><table className="metrics-table"><thead><tr><th>Image</th><th>Damage</th><th>Confidence</th><th>Source</th><th>Location</th><th>Priority</th></tr></thead><tbody>{history.map((item, index) => <tr key={`${item.filename}-${index}`}><td>{item.filename || "Unknown image"}</td><td>{damageLabel(item.damage_type)}</td><td>{(item.confidence * 100).toFixed(1)}%</td><td>{item.source === "mapillary_inference" ? "Mapillary analysis" : item.source === "uploaded_inference" ? "Image analysis" : "Mapillary file"}</td><td>{item.location_status === "road_snapped" ? item.road_id : item.location_status === "geolocated_observation" ? "GPS (unmatched)" : item.location_status === "outside_road_coverage" ? "Outside coverage" : "No GPS"}</td><td>{item.priority ? <span className={`priority-pill ${item.priority.toLowerCase()}`}>{item.priority}</span> : "—"}</td></tr>)}</tbody></table></div>
          {!history.length && <div className="empty-state"><ClipboardCheck size={28} /><h3>No observations to show</h3><p>{data.detections ? "Choose another damage type to see its observations." : "New detections will appear here after image analysis."}</p></div>}
        </div>
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
