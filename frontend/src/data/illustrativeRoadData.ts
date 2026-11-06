export type Priority = "High" | "Medium" | "Low";

export type IllustrativeRoadObservation = {
  id: string;
  area: string;
  latitude: number;
  longitude: number;
  damageType: string;
  conditionScore: number;
  priorityScore: number;
  priority: Priority;
  recommendedAction: string;
  source: "Illustrative presentation dataset";
};

const AREAS = [
  { name: "Central Bengaluru", latitude: 12.9716, longitude: 77.5946 },
  { name: "Indiranagar", latitude: 12.9784, longitude: 77.6408 },
  { name: "Whitefield", latitude: 12.9698, longitude: 77.75 },
  { name: "Marathahalli", latitude: 12.9591, longitude: 77.6974 },
  { name: "Koramangala", latitude: 12.9352, longitude: 77.6245 },
  { name: "HSR Layout", latitude: 12.9116, longitude: 77.6389 },
  { name: "BTM Layout", latitude: 12.9166, longitude: 77.6101 },
  { name: "Jayanagar", latitude: 12.925, longitude: 77.5938 },
  { name: "Rajajinagar", latitude: 12.9911, longitude: 77.5521 },
  { name: "Yeshwanthpur", latitude: 13.028, longitude: 77.54 },
  { name: "Hebbal", latitude: 13.0358, longitude: 77.597 },
  { name: "Electronic City", latitude: 12.8452, longitude: 77.6602 },
];

const DAMAGE_CATEGORY_COUNTS = {
  Pothole: 142,
  "Alligator Crack": 108,
  "Longitudinal Crack": 86,
  "Transverse Crack": 44,
  "Other Corruption": 60,
} as const;
const DAMAGE_TYPES = Object.keys(DAMAGE_CATEGORY_COUNTS);
const DAMAGE_SEQUENCE = DAMAGE_TYPES.flatMap((type) =>
  Array.from({ length: DAMAGE_CATEGORY_COUNTS[type as keyof typeof DAMAGE_CATEGORY_COUNTS] }, () => type),
);

function actionFor(priority: Priority): string {
  return priority === "High"
    ? "Inspect promptly and schedule repair."
    : priority === "Medium"
      ? "Review and plan preventative maintenance."
      : "Monitor during the next inspection cycle.";
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createRecords(priority: Priority, count: number, startIndex: number): IllustrativeRoadObservation[] {
  return Array.from({ length: count }, (_, offset) => {
    const index = startIndex + offset;
    const area = AREAS[index % AREAS.length];
    const random = seededRandom(0x9e3779b9 ^ (index * 2654435761));
    const angle = random() * Math.PI * 2;
    const radius = 0.0012 + Math.pow(random(), 0.7) * 0.008;
    const latitudeOffset = Math.sin(angle) * radius;
    const longitudeOffset = Math.cos(angle) * radius * 1.18;
    const priorityBase = priority === "High" ? 78 : priority === "Medium" ? 58 : 34;
    const priorityScore = priorityBase + (index % 17) * (priority === "High" ? 1.1 : 0.8);
    const conditionScore = Math.max(20, Math.round(100 - priorityScore * 0.72));
    return {
      id: `ILL-${String(index + 1).padStart(3, "0")}`,
      area: area.name,
      latitude: Number((area.latitude + latitudeOffset).toFixed(6)),
      longitude: Number((area.longitude + longitudeOffset).toFixed(6)),
      damageType: DAMAGE_SEQUENCE[index % DAMAGE_SEQUENCE.length],
      conditionScore,
      priorityScore: Number(priorityScore.toFixed(1)),
      priority,
      recommendedAction: actionFor(priority),
      source: "Illustrative presentation dataset",
    };
  });
}

export const ILLUSTRATIVE_ROAD_OBSERVATIONS: IllustrativeRoadObservation[] = [
  ...createRecords("High", 80, 0),
  ...createRecords("Medium", 160, 80),
  ...createRecords("Low", 200, 240),
];

export const ILLUSTRATIVE_COUNTS: Record<Priority, number> = {
  High: 80,
  Medium: 160,
  Low: 200,
};

export const ILLUSTRATIVE_TOTAL = ILLUSTRATIVE_ROAD_OBSERVATIONS.length;

export const ILLUSTRATIVE_DAMAGE_COUNTS = DAMAGE_TYPES.reduce<Record<string, number>>((counts, type) => {
  counts[type] = DAMAGE_CATEGORY_COUNTS[type as keyof typeof DAMAGE_CATEGORY_COUNTS];
  return counts;
}, {});
