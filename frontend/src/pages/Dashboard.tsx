import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, BarChart3, CheckCircle2, ClipboardCheck } from "lucide-react";
import { loadSimulatedDetections, type SimulatedDetection } from "../data/simulatedYoloData";
import type { Priority } from "../data/roadMarkerData";

const PRIORITY_COLORS: Record<Priority, string> = { High: "#dc2626", Medium: "#f59e0b", Low: "#16a34a" };

function Dashboard() {
  const [records, setRecords] = useState<SimulatedDetection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority | "All">("All");
  const [damageType, setDamageType] = useState("All");

  useEffect(() => {
    const controller = new AbortController();
    loadSimulatedDetections(controller.signal).then(setRecords).catch((reason: Error) => {
      if (reason.name !== "AbortError") setError(reason.message);
    });
    return () => controller.abort();
  }, []);

  const priorityCounts = useMemo(() => records.reduce<Record<Priority, number>>((counts, item) => {
    counts[item.priority] += 1;
    return counts;
  }, { High: 0, Medium: 0, Low: 0 }), [records]);
  const categoryCounts = useMemo(() => records.reduce<Record<string, number>>((counts, item) => {
    counts[item.damageType] = (counts[item.damageType] ?? 0) + 1;
    return counts;
  }, {}), [records]);
  const categoryRows = Object.entries(categoryCounts);
  const filteredRecords = useMemo(() => records.filter((item) =>
    (priority === "All" || item.priority === priority)
    && (damageType === "All" || item.damageType === damageType),
  ), [damageType, priority, records]);

  return <div className="dashboard-page">
    <section className="page-hero"><div><p className="eyebrow">ENGINEERING DASHBOARD</p><h1>Bengaluru road resilience intelligence.</h1><p>Explore deterministic YOLO-style damage classifications associated with the available road-marker network.</p></div></section>
    {error && <div className="map-notice"><AlertTriangle size={18} /><span>{error}</span></div>}
    <section className="presentation-stat-grid">
      <Stat label="Road observations" value={String(records.length)} detail="Loaded road markers" />
      <Stat label="High priority" value={String(priorityCounts.High)} detail="Requires prompt review" accent={PRIORITY_COLORS.High} />
      <Stat label="Medium priority" value={String(priorityCounts.Medium)} detail="Planned review" accent={PRIORITY_COLORS.Medium} />
      <Stat label="Low priority" value={String(priorityCounts.Low)} detail="Monitor queue" accent={PRIORITY_COLORS.Low} />
    </section>
    <section className="dashboard-grid dashboard-summary-grid">
      <div className="panel"><div className="panel-header"><div><p className="panel-kicker">PRIORITY DISTRIBUTION</p><h2>Maintenance review queue</h2></div><BarChart3 size={21} /></div><div className="chart-list">{(["High", "Medium", "Low"] as Priority[]).map((item) => <ChartRow key={item} label={item} value={priorityCounts[item]} total={records.length} color={PRIORITY_COLORS[item]} />)}</div></div>
      <div className="panel"><div className="panel-header"><div><p className="panel-kicker">DAMAGE CATEGORY</p><h2>Damage profile</h2></div><ClipboardCheck size={21} /></div><div className="chart-list">{categoryRows.map(([label, value]) => <ChartRow key={label} label={label} value={value} total={records.length} color="#477ba8" />)}</div></div>
    </section>
    <section className="dashboard-grid lower-grid">
      <div className="panel queue-panel"><div className="panel-header"><div><p className="panel-kicker">ROAD MARKER REGISTER</p><h2>Maintenance Review Queue</h2></div><span className="muted-text">{filteredRecords.length} shown</span></div>
        <div className="assessment-toolbar"><select value={priority} onChange={(event) => setPriority(event.target.value as Priority | "All")} aria-label="Filter priority"><option>All</option><option>High</option><option>Medium</option><option>Low</option></select><select value={damageType} onChange={(event) => setDamageType(event.target.value)} aria-label="Filter damage category"><option>All</option>{categoryRows.map(([label]) => <option key={label}>{label}</option>)}</select></div>
        <div className="table-wrapper"><table className="metrics-table"><thead><tr><th>Road / segment</th><th>Area</th><th>Coordinates</th><th>Damage</th><th>Confidence</th><th>Severity</th><th>Priority</th><th>Recommended action</th></tr></thead><tbody>{filteredRecords.map((item) => <tr key={item.id}><td>{item.roadName}<br /><small>{item.roadSegmentId}</small></td><td>{item.area}</td><td>{item.latitude.toFixed(6)}, {item.longitude.toFixed(6)}</td><td>{item.damageType}</td><td>{(item.confidence * 100).toFixed(1)}%</td><td>{item.severity}</td><td><span className={`priority-pill ${item.priority.toLowerCase()}`}>{item.priority}</span></td><td>{item.recommendedAction}</td></tr>)}</tbody></table></div>
        {!filteredRecords.length && <div className="empty-state"><ClipboardCheck size={28} /><h3>No matching road markers</h3><p>Adjust the filters or load the local road geometry.</p></div>}
      </div>
      <div className="panel"><div className="panel-header"><div><p className="panel-kicker">MAINTENANCE WORKFLOW</p><h2>From detection to review</h2></div><CheckCircle2 size={21} /></div><div className="priority-summary"><p>1. Review the simulated damage classification and priority distribution.</p><p>2. Open the map to inspect the same road marker and popup details.</p><p>3. Use Road Assessment to search and filter the shared demo records.</p><div className="dashboard-actions"><a href="/road-map" className="panel-action">Open map<ArrowUpRight size={16} /></a><a href="/road-assessment" className="panel-action">Open assessment<ArrowUpRight size={16} /></a></div></div></div>
    </section>
  </div>;
}

function Stat({ label, value, detail, accent }: { label: string; value: string; detail: string; accent?: string }) { return <div className="presentation-stat"><span>{label}</span><strong style={accent ? { color: accent } : undefined}>{value}</strong><small>{detail}</small></div>; }
function ChartRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) { return <div className="chart-row"><div className="chart-row-label"><span>{label}</span><strong>{value}</strong></div><div className="chart-track"><i style={{ width: total ? `${(value / total) * 100}%` : "0%", backgroundColor: color }} /></div></div>; }
export default Dashboard;
