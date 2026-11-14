"""Small, fail-open client for public OpenStreetMap Overpass instances."""
from __future__ import annotations
import logging, math
from typing import Any
import httpx

logger = logging.getLogger("road_resilience.overpass")
ENDPOINTS = ("https://overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter")
USER_AGENT = "RoadResilienceProject/1.0"

def _query(query: str) -> dict[str, Any] | None:
    for endpoint in ENDPOINTS:
        try:
            with httpx.Client(timeout=8.0, headers={"User-Agent": USER_AGENT}) as client:
                response = client.post(endpoint, data={"data": query})
                response.raise_for_status()
                payload = response.json()
                return payload if isinstance(payload, dict) else None
        except (httpx.HTTPError, ValueError) as exc:
            logger.info("Overpass request failed at %s: %s", endpoint, exc)
    return None

def _nearest(lat: float, lon: float, points: list[dict[str, Any]]) -> tuple[float, float, float] | None:
    if len(points) < 2: return None
    xs, ys = 111320 * math.cos(math.radians(lat)), 111320
    best = None
    for a, b in zip(points, points[1:]):
        x1, y1, x2, y2 = float(a["lon"]), float(a["lat"]), float(b["lon"]), float(b["lat"])
        dx, dy = (x2-x1)*xs, (y2-y1)*ys
        den = dx*dx + dy*dy
        t = 0 if den == 0 else max(0.0, min(1.0, (((lon-x1)*xs*dx)+((lat-y1)*ys*dy))/den))
        slon, slat = x1+(x2-x1)*t, y1+(y2-y1)*t
        distance = math.hypot((lon-slon)*xs, (lat-slat)*ys)
        if best is None or distance < best[0]: best = (distance, slat, slon)
    return best

def fetch_nearest_osm_road(lat: float, lon: float, radius_m: int = 30) -> dict[str, Any] | None:
    q = f'''[out:json][timeout:8];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)$"](around:{int(radius_m)},{lat:.7f},{lon:.7f});out geom;'''
    payload = _query(q)
    best = None
    for way in (payload or {}).get("elements", []):
        tags, geometry = way.get("tags") or {}, way.get("geometry") or []
        snap = _nearest(lat, lon, geometry)
        if snap and (best is None or snap[0] < best[0]): best = (snap[0], way, tags, geometry, snap[1], snap[2])
    if best is None or best[0] > radius_m: return None
    distance, way, tags, geometry, slat, slon = best
    highway = tags.get("highway", "residential")
    return {"osm_way_id": f"osm-way-{way['id']}", "road_name": tags.get("name") or f"Unnamed {highway.title()}",
            "road_type": highway, "lanes": tags.get("lanes"), "maxspeed": tags.get("maxspeed"),
            "geometry": {"type": "LineString", "coordinates": [[float(p["lon"]), float(p["lat"])] for p in geometry]},
            "distance_m": distance, "snapped_latitude": slat, "snapped_longitude": slon}

def check_nearby_critical_facility(lat: float, lon: float, radius_m: int = 300) -> tuple[bool, str | None]:
    q = f'''[out:json][timeout:8];(node["amenity"~"^(hospital|clinic|school|college|fire_station|police)$"](around:{int(radius_m)},{lat:.7f},{lon:.7f});way["amenity"~"^(hospital|clinic|school|college|fire_station|police)$"](around:{int(radius_m)},{lat:.7f},{lon:.7f}););out tags;'''
    payload = _query(q)
    for element in (payload or {}).get("elements", []):
        tags = element.get("tags") or {}
        if tags.get("amenity"):
            return True, f"{tags['amenity'].replace('_', ' ').title()}: {tags.get('name') or 'Unnamed facility'}"
    return False, None

