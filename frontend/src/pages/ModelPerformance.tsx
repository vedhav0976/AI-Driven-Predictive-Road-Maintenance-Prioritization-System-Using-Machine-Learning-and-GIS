import { useEffect, useState } from "react";
import { BarChart3, Info, Target, AlertTriangle } from "lucide-react";
import { apiFetch } from "../api";
import type { Metrics, ModelInfo } from "../api";

function ModelPerformance() {
  const [data, setData] = useState<{ model: ModelInfo; metrics: Metrics } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiFetch<{ model: ModelInfo; metrics: Metrics }>("/api/model/metrics").then(setData).catch((reason: Error) => setError(reason.message)); }, []);
  const metrics = data?.metrics;
  const value = (item?: number | null) => item == null ? "Unavailable" : `${(item * 100).toFixed(2)}%`;
  const dataset = data?.model.dataset;
  return <div className="content-page"><section className="section-heading"><div><p className="eyebrow">MODEL EVALUATION</p><h1>Model performance</h1><p>Latest saved validation results for the selected YOLO training run.</p></div><div className="model-chip"><BarChart3 size={17} /> {data?.model.name ?? "Selected model"}</div></section>
    {error && <div className="map-notice"><AlertTriangle size={18} /><span>{error}</span></div>}
    <section className="metric-grid-large"><PerformanceCard icon={<Target size={21} />} label="Precision" value={value(metrics?.precision)} /><PerformanceCard icon={<Target size={21} />} label="Recall" value={value(metrics?.recall)} /><PerformanceCard icon={<BarChart3 size={21} />} label="mAP@50" value={value(metrics?.map50)} /><PerformanceCard icon={<BarChart3 size={21} />} label="mAP@50–95" value={value(metrics?.map5095)} /></section>
    <section className="panel"><div className="panel-header"><div><p className="panel-kicker">SELECTED VALIDATION RUN</p><h2>{metrics?.run ?? "Loading run"}</h2></div></div><div className="config-list"><Config label="Model" value={data?.model.name ?? "Loading"} /><Config label="Training run" value={metrics?.run ?? data?.model.training_run ?? "Unavailable"} /><Config label="Validation dataset" value={metrics?.validation_dataset ?? data?.model.validation_dataset ?? "Unavailable"} /><Config label="Checkpoint" value={metrics?.checkpoint ?? "Loading"} /><Config label="Completed epochs" value={String(metrics?.epochs ?? "—")} /><Config label="Validation images" value={String(dataset?.val ?? "—")} /></div></section>
    <section className="performance-grid"><div className="panel"><div className="panel-header"><div><p className="panel-kicker">DATASET SPLITS</p><h2>Validation context</h2></div></div><div className="config-list"><Config label="Train images" value={String(dataset?.train ?? "—")} /><Config label="Validation images" value={String(dataset?.val ?? "—")} /><Config label="Test images" value={String(dataset?.test ?? "—")} /><Config label="Images total" value={dataset ? String(dataset.train + dataset.val + dataset.test) : "—"} /><Config label="Inference image size" value={`${data?.model.inference_image_size ?? "—"} × ${data?.model.inference_image_size ?? "—"}`} /></div></div><div className="panel"><div className="panel-header"><div><p className="panel-kicker">LIMITATIONS</p><h2>Interpretation</h2></div></div><div className="map-notice compact"><Info size={17} /><span>These are aggregate values from the final valid row saved by the selected training run. Mapillary inference remains a separate deployment sample.</span></div></div></section>
  </div>;
}
function PerformanceCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="performance-card"><div className="performance-icon">{icon}</div><span>{label}</span><strong>{value}</strong></div>; }
function Config({ label, value }: { label: string; value: string }) { return <div className="config-row"><span>{label}</span><strong>{value}</strong></div>; }
export default ModelPerformance;
