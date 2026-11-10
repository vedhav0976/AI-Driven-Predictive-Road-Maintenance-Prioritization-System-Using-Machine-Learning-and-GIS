import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, BrainCircuit, CheckCircle2, FolderOpen, Upload } from "lucide-react";
import { API_BASE, apiFetch, sampleUrl } from "../api";
import type { Detection, ModelInfo } from "../api";

type AnalysisResult = {
  id: number;
  filename: string;
  model: ModelInfo;
  image_width: number;
  image_height: number;
  detections: Detection[];
  latitude: number | null;
  longitude: number | null;
  location_source: string | null;
  road_id: string | null;
  road_name: string | null;
  snap_distance_m: number | null;
  location_status: string;
  pci_proxy: number | null;
  mpi_proxy: number | null;
  priority: string | null;
  scoring_basis: string;
  annotated_image: string;
  message: string;
};

type Sample = { filename: string; image_id: string; url: string };
type BulkAnalysisResult = Omit<AnalysisResult, "annotated_image"> & {
  annotated_image: null;
  annotated_image_url: string;
};
type BulkItem = {
  id: string;
  file: File;
  signature: string;
  displayName: string;
  previewUrl: string;
  status: "queued" | "processing" | "complete" | "failed";
  result?: BulkAnalysisResult;
  error?: string;
};
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function imageContentType(file: File): string | null {
  if (file.type.startsWith("image/")) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", gif: "image/gif",
  };
  return extension ? types[extension] ?? null : null;
}

function AIDamageAnalysis() {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [samplesLoaded, setSamplesLoaded] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkQueue, setBulkQueue] = useState<BulkItem[]>([]);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [stopAfterCurrent, setStopAfterCurrent] = useState(false);
  const stopBulkRef = useRef(false);
  const bulkRunRef = useRef(false);
  const bulkPreviewUrls = useRef<Set<string>>(new Set());

  useEffect(() => {
    const urls = bulkPreviewUrls.current;
    return () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
  }, []);

  useEffect(() => {
    Promise.all([
      apiFetch<{ model: ModelInfo }>("/api/model/metrics"),
      apiFetch<{ samples: Sample[] }>("/api/samples"),
    ])
      .then(([metrics, sampleData]) => {
        setModel(metrics.model);
        setSamples(sampleData.samples);
        setSamplesLoaded(true);
      })
      .catch(() => { setSamplesLoaded(true); setError("The analysis service is unavailable. Start the backend to load the model and samples."); });
  }, []);

  const chooseFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
    setResult(null);
    setError(null);
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) chooseFile(file);
  };

  const chooseSample = async (filename: string) => {
    try {
      setError(null);
      const response = await fetch(sampleUrl(filename));
      if (!response.ok) {
        throw new Error(`Sample request failed (${response.status}).`);
      }
      const blob = await response.blob();
      chooseFile(new File([blob], filename, { type: blob.type || "image/jpeg" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The sample image could not be loaded.");
    }
  };

  const analyze = async () => {
    if (!selectedFile || bulkBusy) {
      setError("Choose an image before running inference.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      setResult(await apiFetch<AnalysisResult>("/api/damage/analyze", { method: "POST", body: form }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Inference failed.");
    } finally {
      setBusy(false);
    }
  };

  const chooseBulkFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const imageFiles = files.filter((file) => imageContentType(file) !== null)
      .sort((first, second) => (first.webkitRelativePath || first.name).localeCompare(second.webkitRelativePath || second.name, undefined, { numeric: true }));
    const existing = new Set(bulkQueue.map((item) => item.signature));
    const additions = imageFiles.flatMap((file) => {
      const displayName = file.webkitRelativePath || file.name;
      const signature = `${displayName}:${file.size}:${file.lastModified}`;
      if (existing.has(signature)) return [];
      existing.add(signature);
      const tooLarge = file.size > MAX_IMAGE_BYTES;
      const uploadFile = file.type.startsWith("image/") ? file : new File([file], file.name, { type: imageContentType(file)!, lastModified: file.lastModified });
      const previewUrl = URL.createObjectURL(uploadFile);
      bulkPreviewUrls.current.add(previewUrl);
      return [{
        id: crypto.randomUUID(),
        file: uploadFile,
        signature,
        displayName,
        previewUrl,
        status: tooLarge ? "failed" as const : "queued" as const,
        error: tooLarge ? "Image exceeds the 15 MB upload limit." : undefined,
      }];
    });
    setBulkQueue((current) => [...current, ...additions]);
    const skipped = files.length - imageFiles.length;
    const duplicates = imageFiles.length - additions.length;
    setBulkNotice(`${additions.length} image${additions.length === 1 ? "" : "s"} added${skipped ? `; ${skipped} non-image file${skipped === 1 ? "" : "s"} skipped` : ""}${duplicates ? `; ${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped` : ""}.`);
    event.target.value = "";
  };

  const removeBulkItem = (item: BulkItem) => {
    URL.revokeObjectURL(item.previewUrl);
    bulkPreviewUrls.current.delete(item.previewUrl);
    setBulkQueue((current) => current.filter((entry) => entry.id !== item.id));
  };

  const clearBulkQueue = () => {
    for (const item of bulkQueue) {
      URL.revokeObjectURL(item.previewUrl);
      bulkPreviewUrls.current.delete(item.previewUrl);
    }
    setBulkQueue([]);
    setBulkNotice(null);
  };

  const processBulk = async () => {
    const pending = bulkQueue.filter((item) => item.status === "queued");
    if (!pending.length || bulkRunRef.current || busy) return;
    bulkRunRef.current = true;
    stopBulkRef.current = false;
    setStopAfterCurrent(false);
    setBulkBusy(true);
    try {
      for (const item of pending) {
        if (stopBulkRef.current) break;
        setBulkQueue((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "processing" } : entry));
        try {
          const form = new FormData();
          form.append("file", item.file);
          const result = await apiFetch<BulkAnalysisResult>("/api/upload?include_annotated_image=false", {
            method: "POST",
            body: form,
          });
          setBulkQueue((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "complete", result } : entry));
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : "Analysis failed.";
          setBulkQueue((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "failed", error: message } : entry));
        }
      }
    } finally {
      bulkRunRef.current = false;
      setBulkBusy(false);
      setStopAfterCurrent(false);
    }
  };

  const bulkFinished = bulkQueue.filter((item) => item.status === "complete" || item.status === "failed").length;
  const bulkPending = bulkQueue.some((item) => item.status === "queued");

  return (
    <div className="content-page">
      <section className="section-heading">
        <div>
          <p className="eyebrow">COMPUTER VISION</p>
          <h1>AI damage analysis</h1>
          <p>Run inference against the configured road-damage checkpoint.</p>
        </div>
        <div className="model-chip"><BrainCircuit size={17} /> {model?.name ?? "YOLO model"}</div>
      </section>

      {error && <div className="map-notice"><AlertTriangle size={18} /><span>{error}</span></div>}

      <section className="ai-summary-grid">
        <div className="ai-summary-card"><span>MODEL</span><strong>{model?.status === "ready" ? "Ready" : error ? "Unavailable" : "Loading"}</strong><p>{model?.checkpoint ?? "Start the backend to enable inference"}</p></div>
        <div className="ai-summary-card"><span>THRESHOLD</span><strong>{model ? `${Math.round(model.confidence_threshold * 100)}%` : "—"}</strong><p>Configured inference confidence</p></div>
        <div className="ai-summary-card"><span>CLASSES</span><strong>{model ? Object.keys(model.class_names).length : "—"}</strong><p>Verified RDD2022 class mapping</p></div>
        <div className="ai-summary-card"><span>STATUS</span><strong>{result ? "Complete" : "Ready"}</strong><p>Results are never fabricated</p></div>
      </section>

      <div className="analysis-mode-toggle" role="group" aria-label="Upload mode">
        <button type="button" className={mode === "single" ? "active" : ""} aria-pressed={mode === "single"} disabled={busy || bulkBusy} onClick={() => setMode("single")}>Single upload</button>
        <button type="button" className={mode === "bulk" ? "active" : ""} aria-pressed={mode === "bulk"} disabled={busy || bulkBusy} onClick={() => setMode("bulk")}>Bulk upload</button>
      </div>

      {mode === "single" && <section className="panel">
        <div className="panel-header"><div><p className="panel-kicker">INFERENCE WORKSPACE</p><h2>Upload a road image</h2></div></div>
        <div className="analysis-controls">
          <label className="analysis-upload-button">
            <Upload size={18} /><span>Choose image</span>
            <input type="file" accept="image/*" onChange={handleFile} disabled={busy || bulkBusy} hidden />
          </label>
          {samples.length > 0 && (
            <select aria-label="Use a project sample" onChange={(event) => event.target.value && chooseSample(event.target.value)} defaultValue="" disabled={busy || bulkBusy}>
              <option value="">Use a project sample</option>
              {samples.slice(0, 10).map((sample) => <option key={sample.filename} value={sample.filename}>{sample.filename}</option>)}
            </select>
          )}
          {samples.length === 0 && <span className="muted-text">{error ? "Project samples unavailable" : samplesLoaded ? "No project samples installed; choose an image from your computer" : "Loading project samples…"}</span>}
          <button
            className="analysis-run-button"
            type="button"
            onClick={analyze}
            disabled={busy || bulkBusy || !selectedFile}
          >
            <BrainCircuit size={18} />
            {busy ? "Running AI analysis…" : "Run AI Analysis"}
          </button>
        </div>
        <p className="muted-text">GPS is read automatically from image metadata or a visible coordinate stamp.</p>
      </section>}

      {mode === "bulk" && <section className="panel">
        <div className="panel-header"><div><p className="panel-kicker">BULK INFERENCE</p><h2>Process multiple road images</h2></div></div>
        <p className="muted-text">Add images or a folder to the queue. Images are processed one at a time, and each result is saved separately.</p>
        <div className="analysis-controls">
          <label className="analysis-upload-button">
            <Upload size={18} /><span>Add images</span>
            <input type="file" accept="image/*" multiple onChange={chooseBulkFiles} disabled={busy || bulkBusy} hidden />
          </label>
          <label className="analysis-upload-button">
            <FolderOpen size={18} /><span>Add folder</span>
            <input type="file" multiple ref={(input) => { if (input) input.setAttribute("webkitdirectory", ""); }} onChange={chooseBulkFiles} disabled={busy || bulkBusy} hidden />
          </label>
          <button className="analysis-run-button" type="button" onClick={processBulk} disabled={busy || bulkBusy || !bulkPending}>
            <BrainCircuit size={18} />{bulkBusy ? "Processing queue…" : bulkFinished ? "Process remaining" : "Run Bulk Analysis"}
          </button>
          {bulkBusy && <button className="panel-action" type="button" onClick={() => { stopBulkRef.current = true; setStopAfterCurrent(true); }} disabled={stopAfterCurrent}>{stopAfterCurrent ? "Stopping after current image…" : "Stop after current image"}</button>}
        </div>
        {bulkNotice && <p className="bulk-notice" role="status">{bulkNotice}</p>}
        {bulkQueue.length > 0 && <>
          <div className="bulk-queue-heading"><div><strong>Processing queue</strong><span>{bulkQueue.length} image{bulkQueue.length === 1 ? "" : "s"} · {bulkFinished} finished{bulkBusy ? " · processing one image at a time" : ""}</span></div><button className="panel-action" type="button" onClick={clearBulkQueue} disabled={bulkBusy}>Clear queue</button></div>
          <progress className="bulk-progress" value={bulkFinished} max={bulkQueue.length} aria-label="Bulk analysis progress" />
          <ol className="bulk-results">
            {bulkQueue.map((item) => <li key={item.id} className="bulk-result-row">
              <div className="bulk-row-main">
                <img src={item.previewUrl} alt={`Original ${item.displayName}`} loading="lazy" />
                <div className="bulk-row-name"><strong>{item.displayName}</strong><span>{(item.file.size / 1024 / 1024).toFixed(2)} MB</span></div>
                <span className={`bulk-status ${item.status}`}>{item.status}</span>
                <button className="panel-action" type="button" onClick={() => removeBulkItem(item)} disabled={bulkBusy} aria-label={`Remove ${item.displayName} from queue`}>Remove</button>
              </div>
              {item.status === "processing" && <p className="bulk-row-message">Running model inference…</p>}
              {item.error && <p className="bulk-error bulk-row-message">{item.error}</p>}
              {item.result && <div className="bulk-result-detail">
                <a href={`${API_BASE}${item.result.annotated_image_url}`} target="_blank" rel="noreferrer"><img src={`${API_BASE}${item.result.annotated_image_url}`} alt={`Annotated result for ${item.displayName}`} loading="lazy" /></a>
                <div><strong>{item.result.detections.length} detection{item.result.detections.length === 1 ? "" : "s"}</strong><p>{item.result.detections.length ? item.result.detections.map((detection) => `${detection.class_name.replaceAll("_", " ")} ${(detection.confidence * 100).toFixed(1)}%`).join(", ") : "No damage detected at the configured threshold."}</p><p>{item.result.latitude == null ? "No readable GPS" : item.result.road_id ? `Road ${item.result.road_id}` : "GPS outside road coverage"} · PCI {item.result.pci_proxy?.toFixed(1) ?? "—"} · MPI {item.result.mpi_proxy?.toFixed(1) ?? "—"} · {item.result.priority ?? "Unassessed"}</p><Link to={`/history/${item.result.id}`}>View full analysis</Link></div>
              </div>}
            </li>)}
          </ol>
        </>}
      </section>}

      {mode === "single" && preview && (
        <section className="ai-analysis-grid">
          <div className="panel">
            <div className="panel-header"><div><p className="panel-kicker">ORIGINAL</p><h2>{selectedFile?.name}</h2></div></div>
            <img src={preview} alt="Selected road" style={{ width: "100%", borderRadius: 12 }} />
          </div>
          <div className="panel">
            <div className="panel-header"><div><p className="panel-kicker">ANNOTATED OUTPUT</p><h2>{result ? "Model result" : "Awaiting inference"}</h2></div></div>
            {busy ? (
              <div className="loading-state"><span className="loading-spinner" />Running the model against {selectedFile?.name}…</div>
            ) : error ? (
              <div className="analysis-output-error"><AlertTriangle size={18} /><span>{error}</span></div>
            ) : result ? (
              <img src={result.annotated_image} alt="Annotated model output" style={{ width: "100%", borderRadius: 12 }} />
            ) : (
              <div className="analysis-output-empty"><p>Select an image, then choose <strong>Run AI Analysis</strong> to generate the annotated output.</p></div>
            )}
          </div>
        </section>
      )}

      {mode === "single" && result && (
        <section className="panel">
          <div className="panel-header"><div><p className="panel-kicker">DETECTIONS</p><h2>{result.message}</h2></div><Link className="panel-action" to={`/history/${result.id}`}>View saved analysis</Link></div>
          <div className="config-list">
            <div className="config-row"><span>Image location</span><strong>{result.latitude == null ? "No readable GPS in image" : `${result.latitude.toFixed(6)}, ${result.longitude?.toFixed(6)} (${result.location_source === "image_overlay" ? "image stamp" : "EXIF"})`}</strong></div>
            <div className="config-row"><span>Nearest road</span><strong>{result.road_id ? `${result.road_name ?? result.road_id} (${result.snap_distance_m} m)` : result.location_status === "no_gps" ? "No GPS" : "Outside local road coverage"}</strong></div>
            <div className="config-row"><span>PCI proxy</span><strong>{result.pci_proxy?.toFixed(1) ?? "Unassessed"}</strong></div>
            <div className="config-row"><span>MPI proxy / priority</span><strong>{result.mpi_proxy == null ? "Unassessed" : `${result.mpi_proxy.toFixed(1)} / ${result.priority}`}</strong></div>
          </div>
          <p className="muted-text">{result.scoring_basis}</p>
          {result.detections.length === 0 ? (
            <div className="map-notice"><CheckCircle2 size={18} /><span>No damage detected by the model at the configured threshold. This is not proof that the image is damage-free.</span></div>
          ) : (
            <div className="table-wrapper"><table className="metrics-table"><thead><tr><th>Class</th><th>Confidence</th><th>Bounding box (x1, y1, x2, y2)</th></tr></thead><tbody>{result.detections.map((item, index) => <tr key={`${item.class_id}-${index}`}><td>{item.class_name}</td><td>{(item.confidence * 100).toFixed(1)}%</td><td>{item.bbox.join(", ")}</td></tr>)}</tbody></table></div>
          )}
        </section>
      )}
    </div>
  );
}

export default AIDamageAnalysis;
