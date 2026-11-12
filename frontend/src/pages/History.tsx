import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, History as HistoryIcon, Plus, Search, Trash2, X } from "lucide-react";
import { API_BASE, apiFetch } from "../api";
import type { SavedAnalysisDetail, SavedAnalysisSummary } from "../api";
import "./AnalysisWorkspace.css";

const PAGE_SIZE = 20;

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function locationLabel(item: SavedAnalysisSummary): string {
  if (item.latitude == null || item.longitude == null) return "No readable GPS";
  const source = item.location_source === "mapillary" ? "Mapillary coordinates" : item.location_source === "image_overlay" ? "image stamp" : item.location_source === "exif" ? "EXIF" : "saved location";
  return `${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)} (${source})`;
}

function captureLabel(value: number | null): string {
  if (value == null) return "Capture date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Capture date unavailable" : `Captured ${date.toLocaleString()}`;
}

function attributionLink(value: string | null | undefined, hosts: string[], fallback: string): string {
  try {
    const url = new URL(value ?? "");
    if (url.protocol === "https:" && hosts.includes(url.hostname) && !url.username && !url.password) return url.href;
  } catch { /* Fall back to a canonical public attribution link. */ }
  return fallback;
}

function SourceAttribution({ source, annotated = false }: { source: NonNullable<SavedAnalysisSummary["source_metadata"]>; annotated?: boolean }) {
  const imageUrl = attributionLink(source.image_url, ["mapillary.com", "www.mapillary.com"], `https://www.mapillary.com/app/?pKey=${encodeURIComponent(source.image_id)}`);
  const creatorUrl = attributionLink(source.creator_url, ["mapillary.com", "www.mapillary.com"], imageUrl);
  const licenseUrl = attributionLink(source.license_url, ["creativecommons.org", "www.creativecommons.org"], "https://creativecommons.org/licenses/by-sa/4.0/");
  return <p className="history-basis">Photo: <a className="table-record-link" href={imageUrl} target="_blank" rel="noopener noreferrer">Mapillary #{source.image_id}</a>{" · "}Creator: <a className="table-record-link" href={creatorUrl} target="_blank" rel="noopener noreferrer">{source.creator_username ?? source.creator_id ?? "View photo credits"}</a>{" · "}<a className="table-record-link" href={licenseUrl} target="_blank" rel="noopener noreferrer">{source.license}</a><br />{captureLabel(source.captured_at)}. {annotated ? "Annotations added by Road Resilience." : "This is the source image; its capture date may differ from the analysis date."}</p>;
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
    <section className="section-heading"><div><p className="eyebrow">YOUR IMAGE LIBRARY</p><h1>Analysis history</h1><p>Every road image, finding, and assessment in one place.</p></div><Link className="analysis-run-button" to="/ai-analysis"><Plus size={18} />New analysis</Link></section>
    <section className="panel history-panel">
      <div className="panel-header"><div><p className="panel-kicker">SAVED RESULTS</p><h2>Previous analyses</h2></div><span className="analysis-format-chip">{total} {query ? "matching" : "saved"}</span></div>
      <div className="history-toolbar"><label className="search-field"><Search size={17} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search by image name…" aria-label="Search analysis history" />{searchInput && <button className="history-clear-search" type="button" onClick={() => setSearchInput("")} aria-label="Clear search"><X size={16} /></button>}</label><span className="history-sort-note">Newest first</span></div>
      {error && <div className="history-message" role="alert">Could not load history: {error}</div>}
      {loading && <div className="history-message" role="status"><span className="loading-spinner" />Loading saved analyses…</div>}
      {!loading && !error && records.length === 0 && <div className="empty-state"><HistoryIcon size={28} /><h3>{query ? "No matching analyses" : "Your road image library starts here"}</h3><p>{query ? "Try a different image name or clear the search." : "Analyze your first road photo to save images, detections, and condition scores."}</p>{!query && <Link className="panel-action" to="/ai-analysis">Start an analysis<ArrowUpRight size={16} /></Link>}</div>}
      {!loading && !error && records.length > 0 && <div className="history-list">{records.map((item) =>
        <Link to={`/history/${item.id}`} className="history-entry" key={item.id}>
          <img src={`${API_BASE}${item.annotated_image_url}`} alt={`Annotated result for ${item.filename}`} loading="lazy" />
          <div className="history-entry-main"><strong>{item.filename}</strong><span>Analyzed {dateLabel(item.created_at)} · {item.detection_count} detection{item.detection_count === 1 ? "" : "s"}</span>{item.source_metadata?.provider === "mapillary" && <span>Mapillary · {captureLabel(item.source_metadata.captured_at)}</span>}<span className="history-road-label">{item.road_name ?? item.road_id ?? (item.latitude == null ? "No readable GPS" : "Outside local road coverage")}</span></div>
          <div className="history-entry-side">{item.priority ? <span className={`priority-pill ${item.priority.toLowerCase()}`}>{item.priority}</span> : <span>Unassessed</span>}<span>View analysis <ChevronRight size={16} /></span></div>
        </Link>,
      )}</div>}
      {!error && total > PAGE_SIZE && <div className="history-pagination"><span>{total ? `${offset + 1}–${Math.min(offset + records.length, total)} of ${total}` : "0 results"}</span><div><button className="panel-action" type="button" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}><ChevronLeft size={16} />Previous</button><button className="panel-action" type="button" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total}>Next<ChevronRight size={16} /></button></div></div>}
    </section>
  </div>;
}

function HistoryDetail({ recordId }: { recordId: string }) {
  const navigate = useNavigate();
  const [record, setRecord] = useState<SavedAnalysisDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteKey, setDeleteKey] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch<SavedAnalysisDetail>(`/api/detections/${encodeURIComponent(recordId)}`)
      .then((data) => { if (active) { setRecord(data); setError(null); } })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [recordId]);

  const removeAnalysis = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!record || !deleteKey.trim() || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch<{ deleted_id: number }>(`/api/detections/${record.id}`, {
        method: "DELETE",
        headers: { "X-Delete-Key": deleteKey.trim() },
      });
      navigate("/history", { replace: true });
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "Could not delete this analysis.");
    } finally {
      setDeleting(false);
    }
  };

  return <div className="content-page">
    <section className="section-heading"><div><p className="eyebrow">SAVED RESULT</p><h1>Previous analysis</h1><p>Review the stored result without running the model again.</p></div><div className="history-actions"><Link className="panel-action history-back" to="/history"><ArrowLeft size={16} />All analyses</Link>{record && <button className="panel-action history-delete-trigger" type="button" onClick={() => { setConfirmingDelete(true); setDeleteError(null); }} disabled={deleting}><Trash2 size={15} />Delete analysis</button>}</div></section>
    {error && <div className="history-message" role="alert">Could not load analysis: {error}</div>}
    {!record && !error && <div className="history-message">Loading analysis…</div>}
    {record && <>
      {confirmingDelete && <section className="panel history-delete-panel" aria-label="Confirm deletion"><div className="history-delete-heading"><span><Trash2 size={20} /></span><div><h2>Delete this analysis?</h2><p>Analysis #{record.id} · This action cannot be undone.</p></div></div><p>This removes the saved result, original and annotated images, and its road assessment from the live database.</p><form onSubmit={removeAnalysis}><label htmlFor="delete-key">Enter your deletion key</label><input id="delete-key" type="password" autoComplete="off" placeholder="Deletion key" aria-describedby="delete-key-help" value={deleteKey} onChange={(event) => setDeleteKey(event.target.value)} required disabled={deleting} autoFocus /><span className="history-delete-help" id="delete-key-help">Only an administrator with the deletion key can remove a saved analysis.</span><div className="history-delete-actions"><button type="button" onClick={() => { setConfirmingDelete(false); setDeleteKey(""); setDeleteError(null); }} disabled={deleting}>Keep analysis</button><button className="history-delete-confirm" type="submit" disabled={deleting || !deleteKey.trim()}><Trash2 size={16} />{deleting ? "Deleting…" : "Permanently delete"}</button></div></form>{deleteError && <p className="history-delete-error" role="alert">{deleteError}</p>}</section>}
      <section className="panel history-detail-summary"><div className="panel-header"><div><p className="panel-kicker">ANALYSIS #{record.id}</p><h2>{record.filename}</h2></div>{record.priority ? <span className={`priority-pill ${record.priority.toLowerCase()}`}>{record.priority}</span> : <span className="muted-text">Unassessed</span>}</div>
        <div className="history-facts"><div><span>Analyzed</span><strong>{dateLabel(record.created_at)}</strong></div>{record.source_metadata?.provider === "mapillary" && <div><span>Image captured</span><strong>{captureLabel(record.source_metadata.captured_at).replace(/^Captured /, "")}</strong></div>}<div><span>Detections</span><strong>{record.detection_count}</strong></div><div><span>Location</span><strong>{locationLabel(record)}</strong></div><div><span>Road segment</span><strong>{record.road_name ?? record.road_id ?? (record.latitude == null ? "No GPS" : "Outside local coverage")}</strong></div><div><span>PCI proxy</span><strong>{record.pci_proxy?.toFixed(1) ?? "Unassessed"}</strong></div><div><span>MPI proxy</span><strong>{record.mpi_proxy?.toFixed(1) ?? "Unassessed"}</strong></div></div>
      </section>
      <section className="history-images"><div className="panel"><div className="panel-header"><div><p className="panel-kicker">{record.source_metadata?.provider === "mapillary" ? "MAPILLARY IMAGE" : "UPLOADED IMAGE"}</p><h2>Original</h2></div></div><a href={`${API_BASE}/api/detections/${record.id}/original`} target="_blank" rel="noreferrer"><img src={`${API_BASE}/api/detections/${record.id}/original`} alt={`Original image ${record.filename}`} /></a>{record.source_metadata?.provider === "mapillary" && <SourceAttribution source={record.source_metadata} />}</div><div className="panel"><div className="panel-header"><div><p className="panel-kicker">MODEL OUTPUT</p><h2>Annotated</h2></div></div><a href={`${API_BASE}${record.annotated_image_url}`} target="_blank" rel="noreferrer"><img src={`${API_BASE}${record.annotated_image_url}`} alt={`Annotated result ${record.filename}`} /></a>{record.source_metadata?.provider === "mapillary" && <SourceAttribution source={record.source_metadata} annotated />}</div></section>
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
