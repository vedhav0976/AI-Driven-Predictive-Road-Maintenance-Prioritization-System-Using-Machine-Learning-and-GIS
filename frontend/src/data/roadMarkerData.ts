export type Priority = "High" | "Medium" | "Low";

export type RoadMarker = {
  id: string;
  area: string;
  latitude: number;
  longitude: number;
  priority: Priority;
  roadName: string;
  roadSegmentId: string;
  damageType: string;
  source: "Local OSM road geometry";
};

type RoadWay = {
  id: number;
  tags?: { highway?: string; name?: string };
  geometry: Array<{ lat: number; lon: number }>;
};

type Coordinate = [number, number];

const LOCAL_ROAD_URL = "/bengaluru-roads.geojson";
const ROAD_CACHE_KEY = "road-resilience:local-bengaluru-roads:v2";
const LEGACY_ROAD_CACHE_KEY = "road-resilience:local-bengaluru-roads:v1";
const PRIORITY_COUNTS: Record<Priority, number> = { High: 80, Medium: 160, Low: 200 };
export const PRIORITY_COLORS: Record<Priority, string> = { High: "#dc2626", Medium: "#f59e0b", Low: "#16a34a" };

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const shuffled = items.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

const METERS_PER_DEGREE = 111_320;
const MAX_ROAD_MATCH_DISTANCE_METERS = 5;

function projectToMeters(coordinate: Coordinate, referenceLatitude: number): Coordinate {
  return [
    coordinate[0] * METERS_PER_DEGREE,
    coordinate[1] * METERS_PER_DEGREE * Math.cos((referenceLatitude * Math.PI) / 180),
  ];
}

function distanceMeters(a: Coordinate, b: Coordinate): number {
  const referenceLatitude = (a[0] + b[0]) / 2;
  const projectedA = projectToMeters(a, referenceLatitude);
  const projectedB = projectToMeters(b, referenceLatitude);
  return Math.hypot(projectedA[0] - projectedB[0], projectedA[1] - projectedB[1]);
}

function isValidWay(way: RoadWay): boolean {
  return way.geometry.length > 1 && way.geometry.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
}

function areaForWay(way: RoadWay): string {
  const name = way.tags?.name?.toLowerCase() ?? "";
  return name.includes("mg-road") || name.includes("halasuru") || name.includes("trinity")
    ? "MG Road – Trinity Circle – Halasuru"
    : "Richmond Town – Austin Town";
}

function isSuitableRoad(way: RoadWay): boolean {
  const highway = way.tags?.highway;
  return highway == null || ["primary", "secondary", "tertiary", "residential", "unclassified"].includes(highway);
}

function distanceToRoadMeters(coordinate: Coordinate, way: RoadWay): number {
  const pointProjected = projectToMeters(coordinate, coordinate[0]);
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < way.geometry.length - 1; index += 1) {
    const start = way.geometry[index];
    const end = way.geometry[index + 1];
    const startProjected = projectToMeters([start.lat, start.lon], coordinate[0]);
    const endProjected = projectToMeters([end.lat, end.lon], coordinate[0]);
    const startX = startProjected[1];
    const startY = startProjected[0];
    const endX = endProjected[1];
    const endY = endProjected[0];
    const pointX = pointProjected[1];
    const pointY = pointProjected[0];
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX ** 2 + deltaY ** 2;
    const fraction = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared));
    const projectedPoint: Coordinate = [
      start.lat + (end.lat - start.lat) * fraction,
      start.lon + (end.lon - start.lon) * fraction,
    ];
    closestDistance = Math.min(closestDistance, distanceMeters(coordinate, projectedPoint));
  }
  return closestDistance;
}

export function filterRoadMarkers(markers: RoadMarker[], ways: RoadWay[]): RoadMarker[] {
  const suitableRoads = ways.filter((way) => isValidWay(way) && isSuitableRoad(way));
  return markers.filter((marker) => {
    const coordinate: Coordinate = [marker.latitude, marker.longitude];
    return suitableRoads.some((way) => distanceToRoadMeters(coordinate, way) <= MAX_ROAD_MATCH_DISTANCE_METERS);
  });
}

export async function loadRoadGeometry(signal?: AbortSignal): Promise<RoadWay[]> {
  sessionStorage.removeItem(LEGACY_ROAD_CACHE_KEY);
  const cached = sessionStorage.getItem(ROAD_CACHE_KEY);
  if (cached) {
    try {
      const ways = JSON.parse(cached) as RoadWay[];
      const validWays = Array.isArray(ways) ? ways.filter(isValidWay) : [];
      if (validWays.length) return validWays;
    } catch {
      sessionStorage.removeItem(ROAD_CACHE_KEY);
    }
  }

  const response = await fetch(LOCAL_ROAD_URL, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`Local Bengaluru road geometry could not be loaded (${response.status}).`);
  const payload = (await response.json()) as {
    features?: Array<{
      id?: string | number;
      properties?: { highway?: string; name?: string };
      geometry?: { type?: string; coordinates?: number[][] | number[][][] };
    }>;
  };
  const ways: RoadWay[] = [];
  (Array.isArray(payload.features) ? payload.features : []).forEach((feature, index) => {
    const geometry = feature.geometry;
    const coordinates = geometry?.coordinates;
    const lines: number[][][] = geometry?.type === "LineString" && Array.isArray(coordinates)
      ? [coordinates as number[][]]
      : geometry?.type === "MultiLineString" && Array.isArray(coordinates)
        ? coordinates as number[][][]
        : [];
    lines.forEach((line, lineIndex) => {
      const points = (Array.isArray(line) ? line : [])
        .filter((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
        .map(([longitude, latitude]) => ({ lat: latitude, lon: longitude }));
      const way = { id: index * 1000 + lineIndex, tags: feature.properties, geometry: points };
      if (isValidWay(way)) ways.push(way);
    });
  });
  if (!ways.length) throw new Error("The local road file contains no usable road lines.");
  sessionStorage.setItem(ROAD_CACHE_KEY, JSON.stringify(ways));
  return ways;
}

export function createRoadMarkers(ways: RoadWay[]): RoadMarker[] {
  const roads = ways.filter((way) => isValidWay(way) && isSuitableRoad(way));
  if (!roads.length) throw new Error("The local road file contains no usable road lines.");
  const random = seededRandom(0x5eed2026);
  const roadOrder = shuffle(roads, random);
  const points: Array<{ coordinate: Coordinate; way: RoadWay }> = [];
  const minimumSeparationMeters = 8;
  let attempts = 0;

  while (points.length < 440 && attempts < 30000) {
    attempts += 1;
    const way = roadOrder[points.length % roadOrder.length];
    const segmentIndex = Math.floor(random() * (way.geometry.length - 1));
    const start = way.geometry[segmentIndex];
    const end = way.geometry[segmentIndex + 1];
    const coordinate: Coordinate = [
      start.lat + (end.lat - start.lat) * random(),
      start.lon + (end.lon - start.lon) * random(),
    ];
    if (points.some((point) => distanceMeters(point.coordinate, coordinate) < minimumSeparationMeters)) continue;
    points.push({ coordinate, way });
  }

  while (points.length < 440) {
    const way = roadOrder[points.length % roadOrder.length];
    const segmentIndex = Math.floor(random() * (way.geometry.length - 1));
    const start = way.geometry[segmentIndex];
    const end = way.geometry[segmentIndex + 1];
    points.push({
      coordinate: [
        start.lat + (end.lat - start.lat) * random(),
        start.lon + (end.lon - start.lon) * random(),
      ],
      way,
    });
  }

  const priorities = shuffle(
    (Object.entries(PRIORITY_COUNTS) as Array<[Priority, number]>).flatMap(([priority, count]) =>
      Array.from({ length: count }, () => priority),
    ),
    random,
  );
  return shuffle(points, random).map((point, index) => {
    return {
      id: `ROAD-MARKER-${String(index + 1).padStart(3, "0")}`,
      area: areaForWay(point.way),
      latitude: Number(point.coordinate[0].toFixed(6)),
      longitude: Number(point.coordinate[1].toFixed(6)),
      priority: priorities[index],
      roadName: point.way.tags?.name ?? "Unnamed road",
      roadSegmentId: `local-osm-way-${point.way.id}`,
      damageType: "Not classified",
      source: "Local OSM road geometry",
    };
  });
}
