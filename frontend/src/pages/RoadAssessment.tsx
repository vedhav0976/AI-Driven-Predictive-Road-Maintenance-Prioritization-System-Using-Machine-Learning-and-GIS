import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Info, Search } from "lucide-react";
import { apiFetch, type InspectionObservation } from "../api";

type Priority = "High" | "Medium" | "Low";

function RoadAssessment() {
  const [records, setRecords] = useState<InspectionObservation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<Priority | "All">("All");
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const path = `/api/observations?limit=200${priority === "All" ? "" : `&priority=${priority}`}`;
    const load = () => apiFetch<{ records: InspectionObservation[] }>(path)
      .then((result) => { if (active) { setRecords(result.records); setError(null); } })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [priority]);

  const filteredRecords = useMemo(() => records.filter((item) =>
    `${item.id} ${item.filename} ${item.road_id ?? ""} ${item.damage_types.join(" ")}`
      .toLowerCase().includes(query.toLowerCase()),
  ), [query, records]);
  const recheckLocation = async (item: InspectionObservation) => {
    setCheckingId(item.id);
    setLocationError(null);
    try {
      const updated = await apiFetch<Pick<InspectionObservation, "id" | "latitude" | "longitude" | "location_status" | "location_source" | "road_id"> & { pci_score: number | null; mpi_score: number | null; priority: InspectionObservation["priority"] }>(
        `/api/observations/${item.id}/recheck-location`,
        { method: "POST" },
      );
      setRecords((current) => current.map((record) => record.id === item.id ? { ...record, ...updated, geolocated: true } : record));
    } catch (reason) {
      setLocationError(reason instanceof Error ? reason.message : "Location could not be read from the image.");
    } finally {
      setCheckingId(null);
    }
  };

  return <div className="content-page">
    <section className="section-heading"><div><p className="eyebrow">ROAD INTELLIGENCE</p><h1>Road assessment</h1><p>Saved image analyses and count-weight priority scores. The queue refreshes every 30 seconds.</p></div></section>
    {error && <div className="map-notice"><Info size={18} /><span>Assessment API unavailable: {error}</span></div>}
    <div className="map-notice"><Info size={18} /><span>GPS is read from image metadata or a visible coordinate stamp. Located images appear as points on Road Map; a road color requires a match within 30 m of available road geometry.</span></div>
    <section className="panel assessment-panel"><div className="panel-header"><div><p className="panel-kicker">PRIORITY REGISTER</p><h2>Maintenance review queue</h2></div><span className="muted-text">{filteredRecords.length} shown, up to 200 recent records</span></div>
      <div className="assessment-toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ID, image, road, or damage" /></label><select value={priority} onChange={(event) => setPriority(event.target.value as Priority | "All")} aria-label="Filter priority"><option>All</option><option>High</option><option>Medium</option><option>Low</option></select></div>
      {locationError && <div className="map-notice" role="alert"><Info size={18} /><span>{locationError}</span></div>}
      <div className="table-wrapper"><table className="metrics-table"><thead><tr><th>Image</th><th>Road segment</th><th>Location</th><th>Damage</th><th>Confidence</th><th>PCI proxy</th><th>MPI proxy</th><th>Priority</th><th>Action</th></tr></thead><tbody>{filteredRecords.map((item) => <tr key={item.id}><td>{item.filename}<br /><small>#{item.id}</small></td><td>{item.road_id ?? (item.geolocated ? "Outside local coverage" : "No GPS")}</td><td>{item.latitude == null ? "—" : <>{item.latitude.toFixed(6)}, {item.longitude?.toFixed(6)}<br /><small>{item.location_source === "image_overlay" ? "Image stamp" : item.location_source === "manual" ? "Previously entered" : "EXIF GPS"}</small></>}</td><td>{item.damage_types.join(", ") || "None detected"}</td><td>{item.max_confidence == null ? "—" : `${(item.max_confidence * 100).toFixed(1)}%`}</td><td>{item.pci_score?.toFixed(1) ?? "—"}</td><td>{item.mpi_score?.toFixed(1) ?? "—"}</td><td>{item.priority ? <span className={`priority-pill ${item.priority.toLowerCase()}`}>{item.priority}</span> : "Unassessed"}</td><td><button className="panel-action" type="button" onClick={() => void recheckLocation(item)} disabled={checkingId != null}>{checkingId === item.id ? "Reading…" : "Recheck GPS"}</button></td></tr>)}</tbody></table></div>
      {!filteredRecords.length && <div className="empty-state"><ClipboardCheck size={28} /><h3>No matching analyses</h3><p>Upload an image in AI Damage Analysis, or adjust the search and priority filter.</p></div>}
    </section>
  </div>;
}

export default RoadAssessment;
