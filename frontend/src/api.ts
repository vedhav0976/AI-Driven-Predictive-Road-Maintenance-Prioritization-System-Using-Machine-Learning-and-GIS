const API_BASE =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? "http://127.0.0.1:8000" : "/api");

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

export type Metrics = {
  available: boolean;
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
  limitations?: string[];
};

export type DashboardData = {
  images_processed: number;
  detections: number;
  geolocated_observations: number;
  unmatched_observations: number;
  road_segments: number;
  priority_distribution: Record<string, number>;
  model_metrics: Metrics;
  model: ModelInfo;
  history: Array<{
    filename: string;
    damage_type: string;
    confidence: number;
    location_status: string;
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
