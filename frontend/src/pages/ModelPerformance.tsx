import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, BarChart3, Info, Target } from "lucide-react";
import { Link } from "react-router-dom";
import { apiFetch, type Metrics, type ModelInfo } from "../api";

function ModelPerformance() {
  const [data, setData] = useState<{ model: ModelInfo; metrics: Metrics } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<{ model: ModelInfo; metrics: Metrics }>("/api/model/metrics", { signal: controller.signal })
      .then(setData)
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, []);

  const metrics = data?.metrics;
  const dataset = data?.model.dataset;
  const checkpointClasses = Object.values(data?.model.class_names ?? {})
    .map((name) => name.replace(/^D\d+_/, "").replaceAll("_", " "))
    .join(", ") || "Unavailable";
  const percent = (value?: number | null) => value == null ? data || error ? "Unavailable" : "—" : `${(value * 100).toFixed(1)}%`;
  const localCount = (value?: number) => value ? value.toLocaleString() : "Not available locally";

  return <div className="content-page">
    <section className="section-heading"><div><p className="eyebrow">MODEL EVALUATION</p><h1>Understand the model.</h1><p>Explore validation results and the evidence behind road damage detection.</p></div><div className="page-actions"><span className="model-chip"><BarChart3 size={17} />{data?.model.name ?? "YOLO checkpoint"}</span><Link className="button-secondary" to="/ai-analysis">Try an image<ArrowUpRight size={16} /></Link></div></section>
    {error && <div className="map-notice" role="alert"><AlertTriangle size={18} /><span>Model results could not be loaded. {error}</span></div>}
    {!data && !error && <div className="loading-state" role="status"><span className="loading-spinner" />Loading validation results…</div>}
    {metrics?.reported && <div className="data-note"><Info size={18} /><span>These results were reported during training and are linked to the selected checkpoint. They measure the validation set; accuracy on new road images may differ.</span></div>}

    <section className="metric-grid-large">
      <PerformanceCard icon={<Target size={21} />} label="Precision" value={percent(metrics?.precision)} caption="How often detected damage was correct" />
      <PerformanceCard icon={<Target size={21} />} label="Recall" value={percent(metrics?.recall)} caption="How much labeled damage was found" />
      <PerformanceCard icon={<BarChart3 size={21} />} label="mAP at 50%" value={percent(metrics?.map50)} caption="Detection quality at 0.50 box overlap" />
      <PerformanceCard icon={<BarChart3 size={21} />} label="mAP at 50–95%" value={percent(metrics?.map5095)} caption="Detection quality across stricter overlaps" />
    </section>

    {metrics?.per_class?.length ? <section className="panel"><div className="panel-header"><div><p className="panel-kicker">DAMAGE CATEGORY RESULTS</p><h2>Performance by class</h2></div><span className="status-badge">{metrics.reported ? "Training-reported" : "Saved validation run"}</span></div><div className="table-wrapper"><table className="metrics-table"><thead><tr><th>Damage class</th><th>Images</th><th>Instances</th><th>Precision</th><th>Recall</th><th>mAP@50</th><th>mAP@50–95</th></tr></thead><tbody>{metrics.per_class.map((item) => <tr key={item.name}><td><strong>{item.name.replace(/^D\d+_/, "").replaceAll("_", " ")}</strong><br /><small>{item.name.split("_")[0]}</small></td><td>{item.images.toLocaleString()}</td><td>{item.instances.toLocaleString()}</td><td>{percent(item.precision)}</td><td>{percent(item.recall)}</td><td>{percent(item.map50)}</td><td>{percent(item.map5095)}</td></tr>)}</tbody></table></div></section> : null}

    <section className="performance-grid">
      <div className="panel"><div className="panel-header"><div><p className="panel-kicker">VALIDATION CONTEXT</p><h2>Behind these numbers</h2></div></div><div className="config-list">
        <Config label="Evidence source" value={metrics?.reported ? "Training console results" : metrics?.source ?? "Unavailable"} />
        <Config label="Validation images" value={metrics?.validation_images?.toLocaleString() ?? localCount(dataset?.val)} />
        <Config label="Damage instances" value={metrics?.instances?.toLocaleString() ?? "Unavailable"} />
        <Config label="Checkpoint classes" value={checkpointClasses} />
        <Config label="Completed epochs" value={metrics?.epochs?.toString() ?? "Not supplied"} />
        <Config label="Reported inference time" value={metrics?.speed_ms ? `${metrics.speed_ms.inference} ms / image` : "Unavailable"} />
      </div></div>
      <div className="panel"><div className="panel-header"><div><p className="panel-kicker">INTERPRETATION</p><h2>Use the results thoughtfully</h2></div></div>{(metrics?.limitations?.length ? metrics.limitations : [data ? "Validation metrics are unavailable until a matching training result is supplied." : "Validation context will appear once the model results are loaded."]).map((limitation) => <div key={limitation} className="map-notice compact"><Info size={17} /><span>{limitation}</span></div>)}</div>
    </section>
    <details className="data-disclosure"><summary>Checkpoint and technical details</summary><div className="config-list">
      <Config label="Validation run" value={metrics?.run ?? "Unavailable"} />
      <Config label="Checkpoint" value={metrics?.checkpoint ?? "Unavailable"} />
      <Config label="Validation dataset" value={metrics?.validation_dataset ?? "Unavailable"} />
      <Config label="Fused layers" value={metrics?.fused_layers?.toString() ?? "Unavailable"} />
      <Config label="Fused parameters" value={metrics?.fused_parameters?.toLocaleString() ?? "Unavailable"} />
      <Config label="GFLOPs" value={metrics?.gflops?.toString() ?? "Unavailable"} />
      <Config label="Local training images" value={localCount(dataset?.train)} />
      <Config label="Local validation images" value={localCount(dataset?.val)} />
      <Config label="Local test images" value={localCount(dataset?.test)} />
      <Config label="Inference image size" value={`${data?.model.inference_image_size ?? "—"} × ${data?.model.inference_image_size ?? "—"}`} />
    </div></details>
  </div>;
}

function PerformanceCard({ icon, label, value, caption }: { icon: ReactNode; label: string; value: string; caption: string }) {
  return <div className="performance-card"><div className="performance-icon">{icon}</div><span>{label}</span><strong>{value}</strong><p className="metric-caption">{caption}</p></div>;
}

function Config({ label, value }: { label: string; value: string }) {
  return <div className="config-row"><span>{label}</span><strong>{value}</strong></div>;
}

export default ModelPerformance;
