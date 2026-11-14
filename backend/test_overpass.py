import unittest
from unittest.mock import Mock, patch
import httpx
from backend import overpass_client as overpass

class OverpassClientTests(unittest.TestCase):
    def _client(self, response=None, error=None):
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        if error: client.post.side_effect = error
        else: client.post.return_value = response
        return client

    def test_fetch_parses_nearest_road(self):
        response = Mock(); response.raise_for_status.return_value = None
        response.json.return_value = {"elements": [{"id": 42, "tags": {"highway": "primary", "name": "Main Road", "lanes": "2"}, "geometry": [{"lat": 12.0, "lon": 77.0}, {"lat": 12.0, "lon": 77.001}]}]}
        with patch.object(overpass.httpx, "Client", return_value=self._client(response)):
            road = overpass.fetch_nearest_osm_road(12.00001, 77.0005)
        self.assertEqual(road["osm_way_id"], "osm-way-42")
        self.assertEqual(road["road_type"], "primary")
        self.assertEqual(road["road_name"], "Main Road")
        self.assertEqual(road["geometry"]["type"], "LineString")

    def test_timeout_fails_open_and_tries_mirror(self):
        with patch.object(overpass.httpx, "Client", side_effect=httpx.TimeoutException("slow")):
            self.assertIsNone(overpass.fetch_nearest_osm_road(12, 77))

    def test_facility_lookup_and_network_failure(self):
        response = Mock(); response.raise_for_status.return_value = None
        response.json.return_value = {"elements": [{"tags": {"amenity": "hospital", "name": "Baptist Hospital"}}]}
        with patch.object(overpass.httpx, "Client", return_value=self._client(response)):
            self.assertEqual(overpass.check_nearby_critical_facility(12, 77), (True, "Hospital: Baptist Hospital"))
        with patch.object(overpass.httpx, "Client", side_effect=httpx.ConnectError("offline")):
            self.assertEqual(overpass.check_nearby_critical_facility(12, 77), (False, None))

    def test_refresh_caches_facility_and_boosts_mpi(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine) as session:
            segment = RoadSegment(segment_id="osm-way-42", road_name="Main", road_type="residential", criticality_factor=1.0, geometry_geojson='{"type":"LineString","coordinates":[[77,12],[77.001,12]]}')
            session.add(segment); session.flush()
            obs = Observation(filename="a.jpg", original_filename="a.jpg", latitude=12, longitude=77,
                geolocated=True, processed=True, raw_path="a", annotated_path="b", segment_id=segment.segment_id,
                location_status="road_snapped", inference_ms=1, pci_score=85, mpi_score=15, priority_tier="Low")
            session.add(obs); session.flush()
            session.add(DamageDetection(observation_id=obs.id, class_id=2, class_name="D20_Alligator_Crack", confidence=.9,
                bbox_x_center=1, bbox_y_center=1, bbox_width=1, bbox_height=1)); session.flush()
            with patch("backend.overpass_client.check_nearby_critical_facility", return_value=(True, "School: Test School")) as check:
                refresh_road_segment(session, segment.segment_id)
                session.flush()
                refresh_road_segment(session, segment.segment_id)
                self.assertEqual(segment.near_critical_facility, True)
                self.assertEqual(segment.critical_facility_name, "School: Test School")
                self.assertEqual(segment.mpi_score, 18.0)
                self.assertEqual(segment.projected_pci_60d, 76.4)
                check.assert_called_once()
        engine.dispose()

if __name__ == "__main__": unittest.main()
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from backend.database import Base, RoadSegment, Observation, DamageDetection, refresh_road_segment


