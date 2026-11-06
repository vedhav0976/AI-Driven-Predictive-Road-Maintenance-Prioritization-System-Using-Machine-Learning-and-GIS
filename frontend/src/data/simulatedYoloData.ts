import {
  createRoadMarkers,
  filterRoadMarkers,
  loadRoadGeometry,
  type Priority,
  type RoadMarker,
} from "./roadMarkerData";

// Demo-only enrichment of existing road markers; this never calls or replaces YOLO inference.
export type SimulatedDetection = Omit<RoadMarker, "source"> & {
  confidence: number;
  severity: "Low" | "Moderate" | "High" | "Critical";
  recommendedAction: string;
  source: "simulated_demo";
};

const DAMAGE_COUNTS: Record<string, number> = {
  Pothole: 142,
  "Alligator Crack": 108,
  "Longitudinal Crack": 86,
  "Transverse Crack": 44,
  "Other Corruption": 60,
};
const DAMAGE_SEQUENCE = Object.entries(DAMAGE_COUNTS).flatMap(([damageType, count]) =>
  Array.from({ length: count }, () => damageType),
);

function severityFor(priority: Priority, index: number): SimulatedDetection["severity"] {
  if (priority === "High") return index % 3 === 0 ? "Critical" : "High";
  if (priority === "Medium") return "Moderate";
  return "Low";
}

function actionFor(priority: Priority): string {
  if (priority === "High") return "Inspect promptly and schedule repair.";
  if (priority === "Medium") return "Review and plan preventative maintenance.";
  return "Monitor during the next inspection cycle.";
}

export function createSimulatedDetections(ways: Awaited<ReturnType<typeof loadRoadGeometry>>): SimulatedDetection[] {
  const existingMarkers = createRoadMarkers(ways);
  return filterRoadMarkers(existingMarkers, ways).map((marker, index) => ({
    ...marker,
    damageType: DAMAGE_SEQUENCE[index % DAMAGE_SEQUENCE.length],
    confidence: Number((0.68 + (index % 23) * 0.011).toFixed(3)),
    severity: severityFor(marker.priority, index),
    recommendedAction: actionFor(marker.priority),
    source: "simulated_demo",
  }));
}

export async function loadSimulatedDetections(signal?: AbortSignal): Promise<SimulatedDetection[]> {
  const roads = await loadRoadGeometry(signal);
  return createSimulatedDetections(roads);
}

export const SIMULATED_DAMAGE_COUNTS = DAMAGE_COUNTS;
