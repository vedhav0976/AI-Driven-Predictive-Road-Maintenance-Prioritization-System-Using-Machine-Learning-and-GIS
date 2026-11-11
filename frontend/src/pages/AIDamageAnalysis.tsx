import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, BrainCircuit, CheckCircle2, ImagePlus, Images, MapPin, Upload, X } from "lucide-react";
import { API_BASE, apiFetch, sampleUrl } from "../api";
import type { Detection, ModelInfo } from "../api";
import "./AnalysisWorkspace.css";

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
  file?: File;
  driveLink?: string;
  signature: string;
  displayName: string;
  previewUrl?: string;
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
  const [addingDrive, setAddingDrive] = useState(false);
  const [bulkSource, setBulkSource] = useState<"files" | "folder" | "drive">("files");
  const [driveLink, setDriveLink] = useState("");
  const [stopAfterCurrent, setStopAfterCurrent] = useState(false);
  const stopBulkRef = useRef(false);
  const bulkRunRef = useRef(false);
  const bulkPreviewUrls = useRef<Set<string>>(new Set());
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const singleInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

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
      .catch(() => { setSamplesLoaded(true); setError("The analysis service could not be reached. Please try again shortly."); });
  }, []);

  const chooseFile = (file: File) => {
    if (!imageContentType(file)) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Choose an image smaller than 15 MB.");
      return;
    }
    const imageFile = file.type.startsWith("image/") ? file : new File([file], file.name, { type: imageContentType(file)! });
    setSelectedFile(imageFile);
    setPreview(URL.createObjectURL(file));
    setResult(null);
    setError(null);
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) chooseFile(file);
    event.target.value = "";
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

  const addDriveLink = async () => {
    const link = driveLink.trim();
    try {
      const url = new URL(link);
      if (url.protocol !== "https:" || !["drive.google.com", "www.drive.google.com"].includes(url.hostname)) {
        throw new Error("Paste a Google Drive sharing link.");
      }
      setAddingDrive(true);
      setBulkNotice(null);
      const isFolder = url.pathname.split("/").includes("folders");
      const images = isFolder
        ? (await apiFetch<{ images: Array<{ name: string; link: string }> }>("/api/drive/list", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link }),
        })).images
        : [{ name: "Drive image", link }];
      const existing = new Set(bulkQueue.map((item) => item.signature));
      const additions: BulkItem[] = images.flatMap((image) => {
        const signature = `drive:${image.link}`;
        if (existing.has(signature)) return [];
        existing.add(signature);
        return [{ id: crypto.randomUUID(), driveLink: image.link, signature, displayName: image.name, status: "queued" as const }];
      });
      setBulkQueue((current) => [...current, ...additions]);
      setBulkNotice(`${additions.length} Drive image${additions.length === 1 ? "" : "s"} added to the queue${images.length > additions.length ? `; ${images.length - additions.length} already queued` : ""}.`);
      setDriveLink("");
    } catch (reason) {
      setBulkNotice(reason instanceof Error ? reason.message : "Could not add the Drive link.");
    } finally {
      setAddingDrive(false);
    }
  };

  const removeBulkItem = (item: BulkItem) => {
    if (item.previewUrl) { URL.revokeObjectURL(item.previewUrl); bulkPreviewUrls.current.delete(item.previewUrl); }
    setBulkQueue((current) => current.filter((entry) => entry.id !== item.id));
  };

  const clearBulkQueue = () => {
    for (const item of bulkQueue) {
      if (item.previewUrl) { URL.revokeObjectURL(item.previewUrl); bulkPreviewUrls.current.delete(item.previewUrl); }
    }
    setBulkQueue([]);
    setBulkNotice(null);
  };

  const processBulk = async () => {
    const pending = bulkQueue.filter((item) => item.status === "queued");
    if (!pending.length || bulkRunRef.current || busy || addingDrive) return;
    bulkRunRef.current = true;
    stopBulkRef.current = false;
    setStopAfterCurrent(false);
    setBulkBusy(true);
    try {
      for (const item of pending) {
        if (stopBulkRef.current) break;
        setBulkQueue((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "processing" } : entry));
        try {
          let result: BulkAnalysisResult;
          if (item.driveLink) {
            result = await apiFetch<BulkAnalysisResult>("/api/drive/analyze", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ link: item.driveLink, name: item.displayName === "Drive image" ? undefined : item.displayName }),
            });
          } else {
            const form = new FormData();
            form.append("file", item.file!);
            result = await apiFetch<BulkAnalysisResult>("/api/upload?include_annotated_image=false", { method: "POST", body: form });
          }
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
  const completeCount = bulkQueue.filter((item) => item.status === "complete").length;
  const failedCount = bulkQueue.filter((item) => item.status === "failed").length;

  return (
    <div className="content-page">
      <section className="section-heading">
        <div>
          <p className="eyebrow">COMPUTER VISION</p>
          <h1>AI damage analysis</h1>
          <p>Upload road imagery, detect visible damage, and save every assessment.</p>
        </div>
        <div className="model-chip"><BrainCircuit size={17} /> {model?.name ?? "YOLO model"}</div>
      </section>

      {error && <div className="map-notice analysis-alert" role="alert"><AlertTriangle size={18} /><span>{error}</span></div>}

      <section className="ai-summary-grid">
        <div className="ai-summary-card"><span>MODEL</span><strong>{model?.status === "ready" ? "Ready" : error ? "Unavailable" : "Loading"}</strong><p>{model?.name ?? "Connecting to the analysis service"}</p></div>
        <div className="ai-summary-card"><span>THRESHOLD</span><strong>{model ? `${Math.round(model.confidence_threshold * 100)}%` : "—"}</strong><p>Configured inference confidence</p></div>
        <div className="ai-summary-card"><span>CLASSES</span><strong>{model ? Object.keys(model.class_names).length : "—"}</strong><p>Verified RDD2022 class mapping</p></div>
        <div className="ai-summary-card"><span>WORKSPACE</span><strong>{busy || bulkBusy ? "Analyzing" : result || completeCount ? "Results saved" : "Ready to start"}</strong><p>{bulkBusy ? "Processing one image at a time" : "Saved results stay in History"}</p></div>
      </section>

      <div className="analysis-workflow" aria-label="Analysis workflow"><span><b>01</b>Add road images</span><ArrowRight size={16} /><span><b>02</b>Run AI analysis</span><ArrowRight size={16} /><span><b>03</b>Review & prioritize</span></div>

      <div className="analysis-mode-toggle" role="group" aria-label="Upload mode">
        <button type="button" className={mode === "single" ? "active" : ""} aria-pressed={mode === "single"} disabled={busy || bulkBusy} onClick={() => setMode("single")}>Single upload</button>
        <button type="button" className={mode === "bulk" ? "active" : ""} aria-pressed={mode === "bulk"} disabled={busy || bulkBusy} onClick={() => setMode("bulk")}>Bulk upload</button>
      </div>

      {mode === "single" && <section className="panel">
        <div className="panel-header"><div><p className="panel-kicker">SINGLE IMAGE</p><h2>Start with a road photo</h2></div><span className="analysis-format-chip">Images up to 15 MB</span></div>
        <input ref={singleInput} type="file" accept="image/*" onChange={handleFile} disabled={busy || bulkBusy} hidden />
        <button className={`analysis-dropzone ${selectedFile ? "has-file" : ""}`} type="button" onClick={() => singleInput.current?.click()} disabled={busy || bulkBusy} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy && !bulkBusy && event.dataTransfer.files[0]) chooseFile(event.dataTransfer.files[0]); }}>
          <span className="analysis-dropzone-icon">{selectedFile ? <CheckCircle2 size={26} /> : <ImagePlus size={26} />}</span><strong>{selectedFile ? selectedFile.name : "Choose an image or drop it here"}</strong><span>{selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB · Click to replace image` : "Original road photos work best. JPEG, PNG, WebP, and more."}</span>
        </button>
        <div className="analysis-controls">
          {samples.length > 0 && (
            <select aria-label="Use a project sample" onChange={(event) => event.target.value && chooseSample(event.target.value)} defaultValue="" disabled={busy || bulkBusy}>
              <option value="">Use a project sample</option>
              {samples.slice(0, 10).map((sample) => <option key={sample.filename} value={sample.filename}>{sample.filename}</option>)}
            </select>
          )}
          {samples.length === 0 && <span className="analysis-upload-note"><MapPin size={17} />{samplesLoaded ? "GPS is extracted automatically when available." : "Loading image options…"}</span>}
          <button
            className="analysis-run-button"
            type="button"
            onClick={analyze}
            disabled={busy || bulkBusy || !selectedFile}
          >
            <BrainCircuit size={18} />
            {busy ? "Analyzing image…" : "Run analysis"}
          </button>
        </div>
      </section>}

      {mode === "bulk" && <section className="panel">
        <div className="panel-header"><div><p className="panel-kicker">BULK ANALYSIS</p><h2>Build your image queue</h2></div><span className="analysis-format-chip">One image at a time</span></div>
        <p className="analysis-panel-description">Choose a source and add images to the same queue. Each completed result is saved to History.</p>
        <div className="analysis-controls">
          <select aria-label="Image source" value={bulkSource} onChange={(event) => setBulkSource(event.target.value as "files" | "folder" | "drive")} disabled={busy || bulkBusy || addingDrive}>
            <option value="files">Images on device</option><option value="folder">Folder on device</option><option value="drive">Google Drive link</option>
          </select>
          {bulkSource === "drive" && <input className="drive-link-input" type="url" aria-label="Public Google Drive file or folder link" placeholder="Paste public Drive file or folder link" value={driveLink} onChange={(event) => setDriveLink(event.target.value)} disabled={busy || bulkBusy || addingDrive} />}
          <input ref={filesInput} type="file" accept="image/*" multiple onChange={chooseBulkFiles} disabled={busy || bulkBusy || addingDrive} hidden />
          <input ref={(input) => { folderInput.current = input; if (input) input.setAttribute("webkitdirectory", ""); }} type="file" multiple onChange={chooseBulkFiles} disabled={busy || bulkBusy || addingDrive} hidden />
          <button className="analysis-upload-button" type="button" onClick={() => bulkSource === "drive" ? void addDriveLink() : (bulkSource === "folder" ? folderInput : filesInput).current?.click()} disabled={busy || bulkBusy || addingDrive || (bulkSource === "drive" && !driveLink.trim())}>
            <Upload size={18} />{addingDrive ? "Adding…" : "Add to queue"}
          </button>
          <button className="analysis-run-button" type="button" onClick={processBulk} disabled={busy || bulkBusy || addingDrive || !bulkPending}>
            <BrainCircuit size={18} />{bulkBusy ? "Processing queue…" : bulkFinished ? "Process remaining" : "Run analysis"}
          </button>
          {bulkBusy && <button className="panel-action" type="button" onClick={() => { stopBulkRef.current = true; setStopAfterCurrent(true); }} disabled={stopAfterCurrent}>{stopAfterCurrent ? "Stopping after current image…" : "Stop after current image"}</button>}
        </div>
        {bulkSource === "drive" && <p className="bulk-notice">Use an image or folder shared as “Anyone with the link.” Folder imports must be enabled by your administrator.</p>}
        {bulkNotice && <p className="bulk-notice" role="status">{bulkNotice}</p>}
        {bulkQueue.length === 0 && <div className="analysis-queue-empty"><Images size={30} /><h3>Your queue is ready for images</h3><p>Add local images, a folder, or a shared Drive link. You can combine sources before running analysis.</p></div>}
        {bulkQueue.length > 0 && <>
          <div className="bulk-queue-heading"><div><strong>Processing queue <span className="queue-total">{bulkQueue.length}</span></strong><span>{completeCount} complete · {failedCount} failed · {bulkQueue.length - bulkFinished} remaining</span></div><button className="panel-action" type="button" onClick={clearBulkQueue} disabled={bulkBusy || addingDrive}>Clear queue</button></div>
          <progress className="bulk-progress" value={bulkFinished} max={bulkQueue.length} aria-label="Bulk analysis progress" />
          <ol className="bulk-results">
            {bulkQueue.map((item) => <li key={item.id} className="bulk-result-row">
              <div className="bulk-row-main">
                {item.previewUrl ? <img src={item.previewUrl} alt={`Original ${item.displayName}`} loading="lazy" /> : <span className="drive-queue-icon">Drive</span>}
                <div className="bulk-row-name"><strong>{item.displayName}</strong><span>{item.file ? `${(item.file.size / 1024 / 1024).toFixed(2)} MB` : "Google Drive"}</span></div>
                <span className={`bulk-status ${item.status}`}>{item.status}</span>
                <button className="panel-action queue-remove" type="button" onClick={() => removeBulkItem(item)} disabled={bulkBusy || addingDrive} aria-label={`Remove ${item.displayName} from queue`}><X size={16} /></button>
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
