const API_BASE = (import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? "http://127.0.0.1:8000" : "")).replace(/\/+$/, "");

export type ModelInfo = {
  name: string;
  checkpoint: string;
  status: string;
  confidence_threshold: number;
  inference_image_size?: number;
  class_names: Record<string, string>;
  evidence: string;
  training_run?: string | null;
  validation_dataset?: string | null;
  dataset?: { train: number; val: number; test: number };
  error?: string | null;
};

export type Detection = {
  class_id: number;
  class_name: string;
  confidence: number;
  bbox: number[];
};

export type SavedAnalysisSummary = {
  id: number;
  filename: string;
  detection_count: number;
  inference_ms: number;
  created_at: string;
  annotated_image_url: string;
  latitude: number | null;
  longitude: number | null;
  road_id: string | null;
  road_name: string | null;
  location_status: string;
  location_source: string | null;
  pci_proxy: number | null;
  mpi_proxy: number | null;
  priority: "High" | "Medium" | "Low" | null;
};

export type SavedAnalysisDetail = SavedAnalysisSummary & {
  detections: Detection[];
  snap_distance_m: number | null;
  snapped_latitude: number | null;
  snapped_longitude: number | null;
  scoring_basis: string | null;
};

export type Metrics = {
  available: boolean;
  reported?: boolean;
  checkpoint: string;
  run?: string;
  validation_dataset?: string | null;
  epochs?: number;
  precision?: number | null;
  recall?: number | null;
  map50?: number | null;
  map5095?: number | null;
  source?: string;
  per_class_available?: boolean;
  validation_images?: number;
  instances?: number;
  fused_layers?: number;
  fused_parameters?: number;
  gflops?: number;
  speed_ms?: { preprocess: number; inference: number; loss: number; postprocess: number };
  per_class?: Array<{
    name: string;
    images: number;
    instances: number;
    precision: number;
    recall: number;
    map50: number;
    map5095: number;
  }>;
  limitations?: string[];
};

export type DashboardData = {
  images_processed: number;
  uploaded_images: number;
  detections: number;
  geolocated_observations: number;
  unmatched_observations: number;
  road_segments: number;
  priority_distribution: Record<string, number>;
  model_metrics: Metrics;
  model: ModelInfo;
  recent_uploads: Array<{
    id: number;
    filename: string;
    detection_count: number;
    inference_ms: number;
    created_at: string;
    latitude: number | null;
    longitude: number | null;
    road_id: string | null;
    pci_proxy: number | null;
    mpi_proxy: number | null;
    priority: string | null;
  }>;
  history: Array<{
    filename: string;
    damage_type: string;
    confidence: number;
    location_status: string;
    source: string;
    road_id?: string | null;
    pci_proxy?: number | null;
    mpi_proxy?: number | null;
    priority?: string | null;
  }>;
  limitations: string[];
};

export type Observation = {
  image_id: string;
  filename: string;
  damage_type: string;
  confidence: number;
  latitude: number | null;
  longitude: number | null;
  location_status: string;
  location_source: string | null;
  road_id: string | null;
  source: string;
};

export type Assessment = {
  id: string;
  image_id: string;
  damage_type: string;
  condition_score: number | null;
  priority_score: number;
  priority: string;
  basis: string;
  road_id: string | null;
  location_status: string;
  latitude: number | null;
  longitude: number | null;
};

export type RoadsData = {
  records: Assessment[];
  observations: Observation[];
  road_segment_matches: number;
  note: string;
};

export type InspectionObservation = {
  id: number;
  filename: string;
  latitude: number | null;
  longitude: number | null;
  geolocated: boolean;
  location_status: string;
  location_source: string | null;
  road_id: string | null;
  pci_score: number | null;
  mpi_score: number | null;
  priority: "High" | "Medium" | "Low" | null;
  detection_count: number;
  damage_types: string[];
  max_confidence: number | null;
  annotated_image_url: string | null;
  created_at: string;
};

export type PriorityMap = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    geometry: { type: "LineString"; coordinates: number[][] };
    properties: {
      road_name: string | null;
      road_type: string | null;
      criticality_factor: number;
      pci_score: number | null;
      mpi_score: number | null;
      priority: "High" | "Medium" | "Low" | null;
      color: string;
    };
  }>;
};

export type MapillaryRecord = {
  image_id: string;
  filename: string;
  latitude: number | null;
  longitude: number | null;
  captured_at: string | null;
  compass_angle: number | null;
  mapillary_url: string | null;
  local_image_available: boolean;
  detections: Array<{ damage_type: string; confidence: number; bbox: number[] }>;
  detection_count: number;
};

export type MapillaryData = {
  source: string;
  records: MapillaryRecord[];
  total_images: number;
  images_with_local_files: number;
  images_with_detections: number;
  total_detections: number;
  note: string;
};

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {
      // Keep the HTTP status when the server did not return JSON.
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export function sampleUrl(filename: string): string {
  return `${API_BASE}/api/samples/${encodeURIComponent(filename)}`;
}

export { API_BASE };
