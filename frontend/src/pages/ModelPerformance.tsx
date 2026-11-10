import { useEffect, useState } from "react";
import { AlertTriangle, BarChart3, Info, Target } from "lucide-react";
import { apiFetch, type Metrics, type ModelInfo } from "../api";

function ModelPerformance() {
  const [data, setData] = useState<{ model: ModelInfo; metrics: Metrics } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ model: ModelInfo; metrics: Metrics }>("/api/model/metrics")
      .then(setData)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const metrics = data?.metrics;
  const dataset = data?.model.dataset;
  const percent = (value?: number | null) => value == null ? "Unavailable" : `${(value * 100).toFixed(2)}%`;
  const localCount = (value?: number) => value ? value.toLocaleString() : "Not available locally";

  return <div className="content-page">
    <section className="section-heading"><div><p className="eyebrow">MODEL EVALUATION</p><h1>Model performance</h1><p>{metrics?.reported ? "Validation results supplied from the training console and linked to this checkpoint by its SHA-256 hash." : "Saved validation results for the selected YOLO checkpoint."}</p></div><div className="model-chip"><BarChart3 size={17} /> {data?.model.name ?? "Selected model"}</div></section>
    {error && <div className="map-notice"><AlertTriangle size={18} /><span>{error}</span></div>}
    {metrics?.reported && <div className="map-notice"><Info size={18} /><span>Training-reported results. The original validation images and run files are not in this repository; these figures are separate from live uploaded-image detections.</span></div>}

    <section className="metric-grid-large"><PerformanceCard icon={<Target size={21} />} label="Precision" value={percent(metrics?.precision)} /><PerformanceCard icon={<Target size={21} />} label="Recall" value={percent(metrics?.recall)} /><PerformanceCard icon={<BarChart3 size={21} />} label="mAP@50" value={percent(metrics?.map50)} /><PerformanceCard icon={<BarChart3 size={21} />} label="mAP@50–95" value={percent(metrics?.map5095)} /></section>

    <section className="panel"><div className="panel-header"><div><p className="panel-kicker">VALIDATION RUN</p><h2>{metrics?.run ?? "No validation run available"}</h2></div></div><div className="config-list">
      <Config label="Source" value={metrics?.source ?? "Unavailable"} />
      <Config label="Checkpoint" value={metrics?.checkpoint ?? "Unavailable"} />
      <Config label="Validation dataset" value={metrics?.validation_dataset ?? "Unavailable"} />
      <Config label="Validation images" value={metrics?.validation_images?.toLocaleString() ?? localCount(dataset?.val)} />
      <Config label="Damage instances" value={metrics?.instances?.toLocaleString() ?? "Unavailable"} />
      <Config label="Completed epochs" value={metrics?.epochs?.toString() ?? "Not supplied"} />
    </div></section>

    {metrics?.per_class?.length ? <section className="panel"><div className="panel-header"><div><p className="panel-kicker">CLASS RESULTS</p><h2>Reported validation by damage class</h2></div></div><div className="table-wrapper"><table className="metrics-table"><thead><tr><th>Class</th><th>Images</th><th>Instances</th><th>Precision</th><th>Recall</th><th>mAP@50</th><th>mAP@50–95</th></tr></thead><tbody>{metrics.per_class.map((item) => <tr key={item.name}><td>{item.name}</td><td>{item.images.toLocaleString()}</td><td>{item.instances.toLocaleString()}</td><td>{percent(item.precision)}</td><td>{percent(item.recall)}</td><td>{percent(item.map50)}</td><td>{percent(item.map5095)}</td></tr>)}</tbody></table></div></section> : null}

    <section className="performance-grid"><div className="panel"><div className="panel-header"><div><p className="panel-kicker">MODEL AND LOCAL DATA</p><h2>Run context</h2></div></div><div className="config-list">
      <Config label="Fused layers" value={metrics?.fused_layers?.toString() ?? "Unavailable"} />
      <Config label="Fused parameters" value={metrics?.fused_parameters?.toLocaleString() ?? "Unavailable"} />
      <Config label="GFLOPs" value={metrics?.gflops?.toString() ?? "Unavailable"} />
      <Config label="Reported inference speed" value={metrics?.speed_ms ? `${metrics.speed_ms.inference} ms/image` : "Unavailable"} />
      <Config label="Local train images" value={localCount(dataset?.train)} />
      <Config label="Local validation images" value={localCount(dataset?.val)} />
      <Config label="Local test images" value={localCount(dataset?.test)} />
      <Config label="API inference image size" value={`${data?.model.inference_image_size ?? "—"} × ${data?.model.inference_image_size ?? "—"}`} />
    </div></div><div className="panel"><div className="panel-header"><div><p className="panel-kicker">INTERPRETATION</p><h2>Evidence limits</h2></div></div>{(metrics?.limitations?.length ? metrics.limitations : ["Validation metrics are unavailable until a matching training result is supplied."]).map((limitation) => <div key={limitation} className="map-notice compact"><Info size={17} /><span>{limitation}</span></div>)}</div></section>
  </div>;
}

function PerformanceCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="performance-card"><div className="performance-icon">{icon}</div><span>{label}</span><strong>{value}</strong></div>;
}

function Config({ label, value }: { label: string; value: string }) {
  return <div className="config-row"><span>{label}</span><strong>{value}</strong></div>;
}

export default ModelPerformance;
