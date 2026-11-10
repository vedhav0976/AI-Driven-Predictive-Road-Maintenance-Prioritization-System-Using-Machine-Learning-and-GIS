import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, History as HistoryIcon, Search } from "lucide-react";
import { API_BASE, apiFetch } from "../api";
import type { SavedAnalysisDetail, SavedAnalysisSummary } from "../api";

const PAGE_SIZE = 20;

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function locationLabel(item: SavedAnalysisSummary): string {
  if (item.latitude == null || item.longitude == null) return "No readable GPS";
  const source = item.location_source === "image_overlay" ? "image stamp" : item.location_source === "exif" ? "EXIF" : "saved location";
  return `${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)} (${source})`;
}

function HistoryList() {
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [records, setRecords] = useState<SavedAnalysisSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setOffset(0); setQuery(searchInput.trim()); }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (query) params.set("query", query);
    apiFetch<{ records: SavedAnalysisSummary[]; total: number }>(`/api/detections?${params}`)
      .then((data) => { if (active) { setRecords(data.records); setTotal(data.total); setError(null); setLoading(false); } })
      .catch((reason: Error) => { if (active) { setError(reason.message); setLoading(false); } });
    return () => { active = false; };
  }, [offset, query]);

  return <div className="content-page">
    <section className="section-heading"><div><p className="eyebrow">SAVED RESULTS</p><h1>Analysis history</h1><p>Open any previous upload to review its images, detections, and road assessment.</p></div></section>
    <section className="panel history-panel">
      <div className="panel-header"><div><p className="panel-kicker">UPLOADS</p><h2>Previous analyses</h2></div><span className="muted-text">{total} saved</span></div>
      <div className="history-toolbar"><label className="search-field"><Search size={17} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search image name" aria-label="Search analysis history" /></label></div>
      {error && <div className="history-message" role="alert">Could not load history: {error}</div>}
      {loading && <div className="history-message">Loading saved analyses…</div>}
      {!loading && !error && records.length === 0 && <div className="empty-state"><HistoryIcon size={28} /><h3>{query ? "No matching analyses" : "No analyses yet"}</h3><p>{query ? "Try another image name." : "Upload a road image to start your history."}</p></div>}
      {!loading && !error && records.length > 0 && <div className="history-list">{records.map((item) =>
        <Link to={`/history/${item.id}`} className="history-entry" key={item.id}>
          <img src={`${API_BASE}${item.annotated_image_url}`} alt={`Annotated result for ${item.filename}`} loading="lazy" />
          <div className="history-entry-main"><strong>{item.filename}</strong><span>{dateLabel(item.created_at)} · {item.detection_count} detection{item.detection_count === 1 ? "" : "s"}</span><span>{item.road_name ?? item.road_id ?? (item.latitude == null ? "No readable GPS" : "Outside local road coverage")}</span></div>
          <div className="history-entry-side">{item.priority ? <span className={`priority-pill ${item.priority.toLowerCase()}`}>{item.priority}</span> : <span>Unassessed</span>}<span>View analysis <ChevronRight size={16} /></span></div>
        </Link>,
      )}</div>}
      {!error && total > PAGE_SIZE && <div className="history-pagination"><span>{total ? `${offset + 1}–${Math.min(offset + records.length, total)} of ${total}` : "0 results"}</span><div><button className="panel-action" type="button" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}><ChevronLeft size={16} />Previous</button><button className="panel-action" type="button" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total}>Next<ChevronRight size={16} /></button></div></div>}
    </section>
  </div>;
}

function HistoryDetail({ recordId }: { recordId: string }) {
  const [record, setRecord] = useState<SavedAnalysisDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<SavedAnalysisDetail>(`/api/detections/${encodeURIComponent(recordId)}`)
      .then((data) => { if (active) { setRecord(data); setError(null); } })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [recordId]);

  return <div className="content-page">
    <section className="section-heading"><div><p className="eyebrow">SAVED RESULT</p><h1>Previous analysis</h1><p>Review the stored result without running the model again.</p></div><Link className="panel-action history-back" to="/history"><ArrowLeft size={16} />All analyses</Link></section>
    {error && <div className="history-message" role="alert">Could not load analysis: {error}</div>}
    {!record && !error && <div className="history-message">Loading analysis…</div>}
    {record && <>
      <section className="panel history-detail-summary"><div className="panel-header"><div><p className="panel-kicker">ANALYSIS #{record.id}</p><h2>{record.filename}</h2></div>{record.priority ? <span className={`priority-pill ${record.priority.toLowerCase()}`}>{record.priority}</span> : <span className="muted-text">Unassessed</span>}</div>
        <div className="history-facts"><div><span>Analyzed</span><strong>{dateLabel(record.created_at)}</strong></div><div><span>Detections</span><strong>{record.detection_count}</strong></div><div><span>Location</span><strong>{locationLabel(record)}</strong></div><div><span>Road segment</span><strong>{record.road_name ?? record.road_id ?? (record.latitude == null ? "No GPS" : "Outside local coverage")}</strong></div><div><span>PCI proxy</span><strong>{record.pci_proxy?.toFixed(1) ?? "Unassessed"}</strong></div><div><span>MPI proxy</span><strong>{record.mpi_proxy?.toFixed(1) ?? "Unassessed"}</strong></div></div>
      </section>
      <section className="history-images"><div className="panel"><div className="panel-header"><div><p className="panel-kicker">UPLOADED IMAGE</p><h2>Original</h2></div></div><a href={`${API_BASE}/api/detections/${record.id}/original`} target="_blank" rel="noreferrer"><img src={`${API_BASE}/api/detections/${record.id}/original`} alt={`Original upload ${record.filename}`} /></a></div><div className="panel"><div className="panel-header"><div><p className="panel-kicker">MODEL OUTPUT</p><h2>Annotated</h2></div></div><a href={`${API_BASE}${record.annotated_image_url}`} target="_blank" rel="noreferrer"><img src={`${API_BASE}${record.annotated_image_url}`} alt={`Annotated result ${record.filename}`} /></a></div></section>
      <section className="panel history-detections"><div className="panel-header"><div><p className="panel-kicker">MODEL FINDINGS</p><h2>Detected damage</h2></div><span className="muted-text">{record.inference_ms.toFixed(0)} ms inference</span></div>
        {record.detections.length ? <div className="table-wrapper"><table className="metrics-table"><thead><tr><th>Damage class</th><th>Confidence</th><th>Bounding box (x1, y1, x2, y2)</th></tr></thead><tbody>{record.detections.map((item, index) => <tr key={`${item.class_id}-${index}`}><td>{item.class_name}</td><td>{(item.confidence * 100).toFixed(1)}%</td><td>{item.bbox.join(", ")}</td></tr>)}</tbody></table></div> : <p className="history-message">The model recorded no detections for this image.</p>}
        {record.scoring_basis && <p className="history-basis">{record.scoring_basis}</p>}
      </section>
    </>}
  </div>;
}

export default function History() {
  const { recordId } = useParams();
  return recordId ? <HistoryDetail recordId={recordId} /> : <HistoryList />;
}
