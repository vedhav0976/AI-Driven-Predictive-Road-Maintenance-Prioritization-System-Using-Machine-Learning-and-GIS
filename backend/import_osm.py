"""Download a drivable OSM road graph for later offline GIS matching.

Usage: python -m backend.import_osm --place "Bengaluru, Karnataka, India"
Requires backend/requirements-gis.txt and internet access for this explicit import.
Normal API inference reads the saved GeoJSON and never calls Overpass.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path


def first(value):
    value = value[0] if isinstance(value, list) and value else value
    return None if value is None or (isinstance(value, float) and math.isnan(value)) else str(value)


def import_roads(place: str, output: Path) -> int:
    import osmnx as ox

    graph = ox.graph_from_place(place, network_type="drive", simplify=True)
    edges = ox.convert.graph_to_gdfs(graph, nodes=False).to_crs("EPSG:4326")
    features = []
    for (u, v, key), row in edges.iterrows():
        geometry = row.geometry
        if geometry is None or geometry.geom_type != "LineString":
            continue
        features.append({
            "type": "Feature",
            "id": f"osm-edge:{u}:{v}:{key}",
            "properties": {
                "name": first(row.get("name")),
                "highway": first(row.get("highway")),
                "osmid": first(row.get("osmid")),
            },
            "geometry": geometry.__geo_interface__,
        })
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
    return len(features)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--place", default="Bengaluru, Karnataka, India")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data/osm_roads.geojson")
    arguments = parser.parse_args()
    print(f"Saved {import_roads(arguments.place, arguments.output)} OSM edges to {arguments.output}")
