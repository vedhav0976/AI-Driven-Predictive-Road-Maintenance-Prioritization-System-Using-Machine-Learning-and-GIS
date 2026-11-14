"""GPS extraction, local road matching, and transparent prototype scoring.

The score below is a visual damage proxy. It is not an ASTM PCI survey or a
calibrated maintenance priority index: traffic, extent, and field severity are
not available from a single image.
"""

from __future__ import annotations

import json
import math
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from PIL import ExifTags, Image


PROJECT_ROOT = Path(__file__).resolve().parents[1]
IMPORTED_OSM_ROADS = PROJECT_ROOT / "data/osm_roads.geojson"
ROAD_FILE = Path(os.getenv(
    "ROAD_RESILIENCE_ROADS_FILE",
    str(IMPORTED_OSM_ROADS if IMPORTED_OSM_ROADS.is_file() else PROJECT_ROOT / "frontend/public/bengaluru-roads.geojson"),
))
MAX_SNAP_METERS = 30.0
METERS_PER_DEGREE = 111_320.0


def extract_gps(image: Image.Image) -> tuple[float | None, float | None]:
    """Read valid WGS84 GPS coordinates from the original image's EXIF."""
    try:
        exif = image.getexif()
        raw = exif.get_ifd(ExifTags.IFD.GPSInfo)
        gps = {ExifTags.GPSTAGS.get(key, key): value for key, value in raw.items()}

        def coordinate(name: str, ref_name: str, positive_ref: str, negative_ref: str) -> float:
            parts = gps[name]
            value = sum(float(parts[index]) / (60 ** index) for index in range(3))
            ref = gps[ref_name]
            if isinstance(ref, bytes):
                ref = ref.decode("ascii")
            if ref.upper() not in (positive_ref, negative_ref):
                raise ValueError("Invalid GPS direction")
            return -value if ref.upper() == negative_ref else value

        latitude = coordinate("GPSLatitude", "GPSLatitudeRef", "N", "S")
        longitude = coordinate("GPSLongitude", "GPSLongitudeRef", "E", "W")
        if not (math.isfinite(latitude) and math.isfinite(longitude)):
            return None, None
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            return None, None
        if latitude == 0 and longitude == 0:
            return None, None
        return latitude, longitude
    except (AttributeError, KeyError, TypeError, ValueError, ZeroDivisionError, OverflowError):
        return None, None


@lru_cache(maxsize=1)
def road_lines() -> list[tuple[str, str | None, str | None, list[list[float]]]]:
    if not ROAD_FILE.is_file():
        return []
    payload = json.loads(ROAD_FILE.read_text(encoding="utf-8"))
    lines = []
    for index, feature in enumerate(payload.get("features", [])):
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        if geometry.get("type") == "LineString":
            parts = [coordinates]
        elif geometry.get("type") == "MultiLineString":
            parts = coordinates
        else:
            continue
        for part_index, part in enumerate(parts):
            if len(part) >= 2:
                identifier = str(feature.get("id") or f"feature-{index}")
                properties = feature.get("properties") or {}
                lines.append((f"{identifier}:{part_index}", properties.get("name"), properties.get("highway"), part))
    return lines


def road_geometry(road_id: str) -> dict[str, Any] | None:
    for identifier, _name, _road_type, part in road_lines():
        if identifier == road_id:
            return {"type": "LineString", "coordinates": part}
    return None


def criticality_factor(road_type: str | None) -> float:
    if road_type in {"motorway", "trunk", "primary", "primary_link", "trunk_link"}:
        return 1.5
    if road_type in {"secondary", "secondary_link"}:
        return 1.3
    if road_type in {"tertiary", "tertiary_link"}:
        return 1.2
    return 1.0


@lru_cache(maxsize=1)
def projected_roads() -> Any:
    try:
        import geopandas as gpd
        from shapely.geometry import LineString
    except ImportError:
        return None
    lines = road_lines()
    if not lines:
        return None
    return gpd.GeoDataFrame(
        {"road_id": [item[0] for item in lines],
         "road_name": [item[1] for item in lines],
         "road_type": [item[2] for item in lines]},
        geometry=[LineString(item[3]) for item in lines], crs="EPSG:4326",
    ).to_crs("EPSG:32643")


def geopandas_match(latitude: float, longitude: float) -> tuple[float, str, str | None, str | None, float, float] | None:
    """Use a projected metric CRS when the optional GeoPandas stack is installed."""
    roads = projected_roads()
    if roads is None:
        return None
    import geopandas as gpd
    from shapely.geometry import Point
    point = gpd.GeoSeries([Point(longitude, latitude)], crs="EPSG:4326").to_crs("EPSG:32643").iloc[0]
    distances = roads.geometry.distance(point)
    nearest = roads.loc[distances.idxmin()]
    line = nearest.geometry
    snapped = line.interpolate(line.project(point))
    wgs84 = gpd.GeoSeries([snapped], crs="EPSG:32643").to_crs("EPSG:4326").iloc[0]
    road_name = nearest.road_name if isinstance(nearest.road_name, str) else None
    road_type = nearest.road_type if isinstance(nearest.road_type, str) else None
    return float(distances.min()), nearest.road_id, road_name, road_type, wgs84.y, wgs84.x


def snap_to_road(latitude: float | None, longitude: float | None) -> dict[str, Any]:
    """Return nearest local road line within 30 m, or an explicit unmatched state."""
    if latitude is None or longitude is None:
        return {"road_id": None, "road_name": None, "road_type": None,
                "criticality_factor": 1.0, "snap_distance_m": None,
                "snapped_latitude": None, "snapped_longitude": None,
                "location_status": "no_gps"}
    projected_match = geopandas_match(latitude, longitude)
    if projected_match is not None:
        nearest = projected_match
    else:
        nearest = None
    x_scale = METERS_PER_DEGREE * math.cos(math.radians(latitude))
    y_scale = METERS_PER_DEGREE
    for road_id, road_name, road_type, part in ([] if projected_match else road_lines()):
        for start, end in zip(part, part[1:]):
            try:
                x1, y1 = float(start[0]), float(start[1])
                x2, y2 = float(end[0]), float(end[1])
            except (IndexError, TypeError, ValueError):
                continue
            dx, dy = (x2 - x1) * x_scale, (y2 - y1) * y_scale
            length_squared = dx * dx + dy * dy
            fraction = 0.0 if length_squared == 0 else max(0.0, min(1.0,
                (((longitude - x1) * x_scale * dx) + ((latitude - y1) * y_scale * dy)) / length_squared))
            snapped_lon = x1 + (x2 - x1) * fraction
            snapped_lat = y1 + (y2 - y1) * fraction
            distance = math.hypot((longitude - snapped_lon) * x_scale, (latitude - snapped_lat) * y_scale)
            if nearest is None or distance < nearest[0]:
                nearest = distance, road_id, road_name, road_type, snapped_lat, snapped_lon
    # Reuse already persisted Overpass ways before making another public query.
    if nearest is None or nearest[0] > MAX_SNAP_METERS:
        try:
            from backend.database import RoadSegment, get_session
            with get_session() as session:
                cached = session.query(RoadSegment).filter(RoadSegment.segment_id.like("osm-way-%")).all()
                for segment in cached:
                    geo = json.loads(segment.geometry_geojson)
                    coords = geo.get("coordinates", [])
                    if geo.get("type") == "MultiLineString": coords = [p for line in coords for p in line]
                    for a, b in zip(coords, coords[1:]):
                        x1, y1 = float(a[0]), float(a[1]); x2, y2 = float(b[0]), float(b[1])
                        dx, dy = (x2-x1)*x_scale, (y2-y1)*y_scale
                        den = dx*dx + dy*dy
                        t = 0 if den == 0 else max(0.0, min(1.0, (((longitude-x1)*x_scale*dx)+((latitude-y1)*y_scale*dy))/den))
                        slon, slat = x1+(x2-x1)*t, y1+(y2-y1)*t
                        distance = math.hypot((longitude-slon)*x_scale, (latitude-slat)*y_scale)
                        if nearest is None or distance < nearest[0]:
                            nearest = distance, segment.segment_id, segment.road_name, segment.road_type, slat, slon
        except Exception:
            pass
    if nearest is None or nearest[0] > MAX_SNAP_METERS:
        try:
            from backend.overpass_client import fetch_nearest_osm_road
            osm = fetch_nearest_osm_road(latitude, longitude, int(MAX_SNAP_METERS))
        except Exception:
            osm = None
        if osm:
            return {"road_id": osm["osm_way_id"], "road_name": osm["road_name"],
                    "road_type": osm["road_type"], "criticality_factor": criticality_factor(osm["road_type"]),
                    "snap_distance_m": round(osm["distance_m"], 1),
                    "snapped_latitude": osm["snapped_latitude"], "snapped_longitude": osm["snapped_longitude"],
                    "location_status": "road_snapped", "road_geometry": osm["geometry"]}
        return {"road_id": None, "road_name": None, "road_type": None,
                "criticality_factor": 1.0,
                "snap_distance_m": round(nearest[0], 1) if nearest else None,
                "snapped_latitude": None, "snapped_longitude": None,
                "location_status": "outside_road_coverage"}
    distance, road_id, road_name, road_type, snapped_lat, snapped_lon = nearest
    return {"road_id": road_id, "road_name": road_name, "road_type": road_type,
            "criticality_factor": criticality_factor(road_type),
            "snap_distance_m": round(distance, 1), "snapped_latitude": snapped_lat,
            "snapped_longitude": snapped_lon, "location_status": "road_snapped"}


def score_detections(
    detections: list[dict[str, Any]], width: int, height: int, road_type: str | None = None
) -> dict[str, Any]:
    """Apply the supplied count-weight PCI/MPI formula as a visual proxy."""
    _ = width, height  # Retained for existing callers; the specified formula uses counts.
    penalties = {"D00": 8.0, "D10": 8.0, "D20": 15.0, "D40": 20.0}
    weighted = []
    for item in detections:
        class_name = str(item["class_name"]).upper()
        weight = next((value for code, value in penalties.items() if code in class_name), None)
        if weight is not None:
            item["visual_penalty"] = weight
            weighted.append(weight)
    if not weighted:
        return {"pci_proxy": None, "mpi_proxy": None, "priority": None,
                "scoring_basis": "No D00/D10/D20/D40 distress detected; condition is unassessed."}
    pci = round(max(0.0, 100.0 - sum(weighted)), 1)
    mpi = round((100.0 - pci) * criticality_factor(road_type), 1)
    priority = "High" if mpi >= 50 else "Medium" if mpi >= 25 else "Low"
    return {"pci_proxy": pci, "mpi_proxy": mpi, "priority": priority,
            "scoring_basis": "Specified class-count weights and mapped road-class factor; visual proxy, not ASTM PCI or measured traffic criticality."}
