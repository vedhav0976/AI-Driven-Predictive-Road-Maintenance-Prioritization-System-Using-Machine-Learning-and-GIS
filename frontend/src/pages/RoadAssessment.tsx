import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ClipboardCheck, Info, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { apiFetch, type InspectionObservation } from "../api";

type Priority = "High" | "Medium" | "Low";
const damageLabel = (value: string) => value.replace(/^D\d+_/, "").replaceAll("_", " ");

function mapillarySourceLink(item: InspectionObservation): string {
  try {
    const url = new URL(item.source_metadata?.image_url ?? "");
    if (url.protocol === "https:" && ["mapillary.com", "www.mapillary.com"].includes(url.hostname) && !url.username && !url.password) return url.href;
  } catch { /* Use the canonical source page for incomplete metadata. */ }
  return `https://www.mapillary.com/app/?pKey=${encodeURIComponent(item.source_metadata?.image_id ?? "")}`;
}

function RoadAssessment() {
  const [records, setRecords] = useState<InspectionObservation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<Priority | "All">("All");
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const path = `/api/observations?limit=200${priority === "All" ? "" : `&priority=${priority}`}`;
    const load = () => apiFetch<{ records: InspectionObservation[] }>(path)
      .then((result) => { if (active) { setRecords(result.records); setError(null); } })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
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
        `/api/observations/${item.id}/recheck-location`, { method: "POST" },
      );
      setRecords((current) => current.map((record) => record.id === item.id ? { ...record, ...updated, geolocated: true } : record));
    } catch (reason) {
      setLocationError(reason instanceof Error ? reason.message : "Location could not be read from the image.");
    } finally { setCheckingId(null); }
  };
  const hasFilters = query.trim() !== "" || priority !== "All";

  return <div className="content-page">
    <section className="section-heading"><div><p className="eyebrow">INSPECTION PLANNING</p><h1>Road assessment</h1><p>Review saved damage observations and the roads that need a closer look.</p></div><div className="page-actions"><Link className="button-secondary" to="/road-map">View map<ArrowUpRight size={16} /></Link><Link className="button-primary" to="/ai-analysis">Analyze images<ArrowUpRight size={16} /></Link></div></section>
    {error && <div className="map-notice" role="alert"><Info size={18} /><span>We could not refresh assessments. {error}</span></div>}
    <div className="assessment-counts"><span><strong>{records.length}</strong> recent observations{priority !== "All" ? ` · ${priority.toLowerCase()} priority` : ""}</span><span><strong>{records.filter((item) => item.geolocated).length}</strong> with GPS</span><span><strong>{records.filter((item) => item.road_id).length}</strong> matched to a road</span><span className="muted-text">Updates every 30 seconds</span></div>
    <section className="panel assessment-panel">
      <div className="panel-header"><div><p className="panel-kicker">PRIORITY REGISTER</p><h2>Maintenance review queue</h2></div><span className="muted-text">{filteredRecords.length} result{filteredRecords.length === 1 ? "" : "s"}</span></div>
      <div className="assessment-toolbar">
        <label className="search-field"><Search size={17} /><input aria-label="Search assessments" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search an image, road or damage type" /></label>
        <select value={priority} onChange={(event) => setPriority(event.target.value as Priority | "All")} aria-label="Filter priority"><option value="All">All priorities</option><option>High</option><option>Medium</option><option>Low</option></select>
        {hasFilters && <button className="panel-action" type="button" onClick={() => { setQuery(""); setPriority("All"); }}>Clear filters</button>}
      </div>
      {locationError && <div className="map-notice" role="alert"><Info size={18} /><span>{locationError}</span></div>}
      {loading ? <div className="loading-state" role="status"><span className="loading-spinner" />Loading road assessments…</div> : <>
        <div className="table-wrapper"><table className="metrics-table"><thead><tr><th>Image</th><th>Road segment</th><th>Location</th><th>Damage</th><th>Confidence</th><th>PCI proxy</th><th>MPI proxy</th><th>Priority</th><th>Action</th></tr></thead><tbody>{filteredRecords.map((item) => <tr key={item.id}>
          <td><strong>{item.filename}</strong><br /><small>Observation #{item.id}{item.source_metadata?.provider === "mapillary" ? " · Mapillary" : ""}</small></td>
          <td>{item.road_id ?? (item.geolocated ? "Outside road coverage" : "No GPS")}</td>
          <td>{item.latitude == null ? <span className="muted-text">Not located</span> : <>{item.latitude.toFixed(6)}, {item.longitude?.toFixed(6)}<br /><small>{item.location_source === "mapillary" ? "Mapillary coordinates" : item.location_source === "image_overlay" ? "Image stamp" : item.location_source === "manual" ? "Previously entered" : "EXIF GPS"}</small></>}</td>
          <td>{item.damage_types.map(damageLabel).join(", ") || "None detected"}</td><td>{item.max_confidence == null ? "—" : `${(item.max_confidence * 100).toFixed(1)}%`}</td><td>{item.pci_score?.toFixed(1) ?? "—"}</td><td>{item.mpi_score?.toFixed(1) ?? "—"}</td>
          <td>{item.priority ? <span className={`priority-pill ${item.priority.toLowerCase()}`}>{item.priority}</span> : <span className="muted-text">Unassessed</span>}</td>
          <td>{item.source_metadata?.provider === "mapillary" ? <a className="panel-action" href={mapillarySourceLink(item)} target="_blank" rel="noopener noreferrer">View source<ArrowUpRight size={15} /></a> : <button className="panel-action" type="button" onClick={() => void recheckLocation(item)} disabled={checkingId != null}>{checkingId === item.id ? "Reading GPS…" : "Recheck GPS"}</button>}</td>
        </tr>)}</tbody></table></div>
        {!filteredRecords.length && <div className="empty-state"><ClipboardCheck size={30} /><h3>{hasFilters ? "No assessments match your filters" : "Your review queue is clear"}</h3><p>{hasFilters ? "Try another image name, road, damage type or priority." : "Analyze road images to start building a maintenance review queue."}</p>{hasFilters ? <button className="button-secondary" type="button" onClick={() => { setQuery(""); setPriority("All"); }}>Clear filters</button> : <Link className="button-primary" to="/ai-analysis">Analyze images<ArrowUpRight size={16} /></Link>}</div>}
      </>}
    </section>
    <details className="data-disclosure"><summary>About GPS matches and condition scores</summary><p>Coordinates come from Mapillary metadata, image EXIF metadata, or a visible coordinate stamp. Located images appear on the map; a scored road segment needs a match within 30 m of the available geometry.</p><p>PCI and MPI are visual assessment proxies based on detected damage. Use them to guide a field inspection, rather than as a certified pavement condition survey. This queue shows up to 200 recent observations.</p></details>
  </div>;
}

export default RoadAssessment;
