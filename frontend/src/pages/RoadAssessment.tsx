import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, ClipboardCheck, Info, Search } from "lucide-react";
import { loadSimulatedDetections, type SimulatedDetection } from "../data/simulatedYoloData";
import type { Priority } from "../data/roadMarkerData";

function RoadAssessment() {
  const [records, setRecords] = useState<SimulatedDetection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<Priority | "All">("All");
  const [damageType, setDamageType] = useState("All");
  const [descending, setDescending] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    loadSimulatedDetections(controller.signal).then(setRecords).catch((reason: Error) => {
      if (reason.name !== "AbortError") setError(reason.message);
    });
    return () => controller.abort();
  }, []);

  const damageTypes = useMemo(() => [...new Set(records.map((item) => item.damageType))], [records]);
  const filteredRecords = useMemo(() => records.filter((item) => {
    const searchable = `${item.id} ${item.area} ${item.roadName} ${item.roadSegmentId} ${item.damageType}`.toLowerCase();
    return searchable.includes(query.toLowerCase())
      && (priority === "All" || item.priority === priority)
      && (damageType === "All" || item.damageType === damageType);
  }).sort((a, b) => descending ? b.confidence - a.confidence : a.confidence - b.confidence), [damageType, descending, priority, query, records]);

  return <div className="content-page">
    <section className="section-heading"><div><p className="eyebrow">ROAD INTELLIGENCE</p><h1>Road assessment</h1></div></section>
    {error && <div className="map-notice"><Info size={18} /><span>{error}</span></div>}
    <section className="panel assessment-panel"><div className="panel-header"><div><p className="panel-kicker">PRIORITY REGISTER</p><h2>Maintenance review queue</h2></div><span className="muted-text">{filteredRecords.length} shown</span></div>
      <div className="assessment-toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ID, road, area, or damage type" /></label><select value={priority} onChange={(event) => setPriority(event.target.value as Priority | "All")} aria-label="Filter priority"><option>All</option><option>High</option><option>Medium</option><option>Low</option></select><select value={damageType} onChange={(event) => setDamageType(event.target.value)} aria-label="Filter damage category"><option>All</option>{damageTypes.map((item) => <option key={item}>{item}</option>)}</select><button className="sort-button" type="button" onClick={() => setDescending((value) => !value)}><ArrowUpDown size={16} />{descending ? "Highest confidence" : "Lowest confidence"}</button></div>
      <div className="table-wrapper"><table className="metrics-table"><thead><tr><th>Road / segment</th><th>Area</th><th>Coordinates</th><th>Damage</th><th>Confidence</th><th>Severity</th><th>Priority</th><th>Recommended action</th></tr></thead><tbody>{filteredRecords.map((item) => <tr key={item.id}><td>{item.roadName}<br /><small>{item.roadSegmentId}</small></td><td>{item.area}</td><td>{item.latitude.toFixed(6)}, {item.longitude.toFixed(6)}</td><td>{item.damageType}</td><td>{(item.confidence * 100).toFixed(1)}%</td><td>{item.severity}</td><td><span className={`priority-pill ${item.priority.toLowerCase()}`}>{item.priority}</span></td><td>{item.recommendedAction}</td></tr>)}</tbody></table></div>
      {!filteredRecords.length && <div className="empty-state"><ClipboardCheck size={28} /><h3>No matching records</h3><p>Adjust the search or filters.</p></div>}
    </section>
  </div>;
}

export default RoadAssessment;
