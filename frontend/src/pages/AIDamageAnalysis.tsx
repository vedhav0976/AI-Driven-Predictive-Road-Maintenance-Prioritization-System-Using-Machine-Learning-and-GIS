import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { AlertTriangle, BrainCircuit, CheckCircle2, Upload } from "lucide-react";
import { apiFetch, sampleUrl } from "../api";
import type { Detection, ModelInfo } from "../api";

type AnalysisResult = {
  filename: string;
  model: ModelInfo;
  image_width: number;
  image_height: number;
  detections: Detection[];
  annotated_image: string;
  message: string;
};

type Sample = { filename: string; image_id: string; url: string };

function AIDamageAnalysis() {
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<{ model: ModelInfo }>("/api/model/metrics"),
      apiFetch<{ samples: Sample[] }>("/api/samples"),
    ])
      .then(([metrics, sampleData]) => {
        setModel(metrics.model);
        setSamples(sampleData.samples);
      })
      .catch(() => setError("The analysis service is unavailable. Start the backend to load the model and samples."));
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
    if (!selectedFile) {
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

  return (
    <div className="content-page">
      <section className="section-heading">
        <div>
          <p className="eyebrow">COMPUTER VISION</p>
          <h1>AI damage analysis</h1>
          <p>Run real inference against the configured YOLO11n road-damage checkpoint.</p>
        </div>
        <div className="model-chip"><BrainCircuit size={17} /> YOLO11n</div>
      </section>

      {error && <div className="map-notice"><AlertTriangle size={18} /><span>{error}</span></div>}

      <section className="ai-summary-grid">
        <div className="ai-summary-card"><span>MODEL</span><strong>{model?.status === "ready" ? "Ready" : error ? "Unavailable" : "Loading"}</strong><p>{model?.checkpoint ?? "Start the backend to enable inference"}</p></div>
        <div className="ai-summary-card"><span>THRESHOLD</span><strong>{model ? `${Math.round(model.confidence_threshold * 100)}%` : "—"}</strong><p>Configured inference confidence</p></div>
        <div className="ai-summary-card"><span>CLASSES</span><strong>{model ? Object.keys(model.class_names).length : "—"}</strong><p>Verified RDD2022 class mapping</p></div>
        <div className="ai-summary-card"><span>STATUS</span><strong>{result ? "Complete" : "Ready"}</strong><p>Results are never fabricated</p></div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><p className="panel-kicker">INFERENCE WORKSPACE</p><h2>Upload a road image</h2></div></div>
        <div className="analysis-controls">
          <label className="analysis-upload-button">
            <Upload size={18} /><span>Choose image</span>
            <input type="file" accept="image/*" onChange={handleFile} hidden />
          </label>
          {samples.length > 0 && (
            <select aria-label="Use a project sample" onChange={(event) => event.target.value && chooseSample(event.target.value)} defaultValue="">
              <option value="">Use a project sample</option>
              {samples.slice(0, 10).map((sample) => <option key={sample.filename} value={sample.filename}>{sample.filename}</option>)}
            </select>
          )}
          {samples.length === 0 && <span className="muted-text">{error ? "Project samples unavailable" : "Loading project samples…"}</span>}
          <button
            className="analysis-run-button"
            type="button"
            onClick={analyze}
            disabled={busy || !selectedFile}
          >
            <BrainCircuit size={18} />
            {busy ? "Running AI analysis…" : "Run AI Analysis"}
          </button>
        </div>
      </section>

      {preview && (
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

      {result && (
        <section className="panel">
          <div className="panel-header"><div><p className="panel-kicker">DETECTIONS</p><h2>{result.message}</h2></div></div>
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
