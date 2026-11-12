"""Focused checks for GPS, local matching, scoring, and saved API data."""

import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from PIL import ExifTags, Image
from sqlalchemy import event

from backend.assessment import extract_gps, road_geometry, score_detections, snap_to_road
from backend.annotations import box_iou, render_annotations, suppress_duplicate_boxes
from backend.geotag import parse_overlay_coordinates
from backend.preprocess_rdd import filter_dataset


class AssessmentTests(unittest.TestCase):
    def test_overlapping_class_labels_share_one_box(self):
        pothole = {"class_id": 4, "class_name": "D40_Pothole", "confidence": 0.4689,
                   "bbox": [99.48, 123.9, 406.78, 248.46]}
        other = {"class_id": 3, "class_name": "Other_Damage", "confidence": 0.2918,
                 "bbox": [97.31, 126.81, 407.27, 247.06]}
        separate = {"class_id": 0, "class_name": "D00_Longitudinal_Crack", "confidence": 0.4,
                    "bbox": [500, 500, 700, 700]}
        self.assertGreater(box_iou(pothole["bbox"], other["bbox"]), 0.9)
        kept = suppress_duplicate_boxes([other, separate, pothole])
        self.assertEqual(kept, [pothole, separate])
        self.assertEqual(render_annotations(Image.new("RGB", (800, 800)), kept).size[0], 800)

    def test_coordinate_stamp_parser(self):
        self.assertEqual(parse_overlay_coordinates(["Lat 13.162602° Long 77.556895°"]), (13.162602, 77.556895))
        self.assertEqual(parse_overlay_coordinates(["Latitude: 13.162602 N", "Longitude: 77.556895 E"]), (13.162602, 77.556895))
        self.assertEqual(parse_overlay_coordinates(["Road image 2026-11-06"]), (None, None))
        self.assertEqual(parse_overlay_coordinates(["Lat 113.162602 Long 77.556895"]), (None, None))

    def test_exif_gps_and_road_match(self):
        image = Mock()
        image.getexif.return_value.get_ifd.return_value = {
            1: "N", 2: (12, 58, 25.458), 3: "E", 4: (77, 36, 50.009),
        }
        latitude, longitude = extract_gps(image)
        self.assertAlmostEqual(latitude, 12.9737383, places=5)
        self.assertAlmostEqual(longitude, 77.6138914, places=5)
        match = snap_to_road(latitude, longitude)
        self.assertEqual(match["location_status"], "road_snapped")
        self.assertLess(match["snap_distance_m"], 2)
        self.assertEqual(snap_to_road(None, None)["location_status"], "no_gps")
        self.assertEqual(snap_to_road(28.6139, 77.2090)["location_status"], "outside_road_coverage")

    def test_score_is_explicit_proxy(self):
        detections = [{"class_name": "D40_Pothole", "confidence": 0.9, "bbox": [0, 0, 50, 50]}]
        result = score_detections(detections, 100, 100)
        self.assertEqual(result["pci_proxy"], 80)
        self.assertEqual(result["mpi_proxy"], 20)
        self.assertEqual(result["priority"], "Low")
        self.assertEqual(score_detections(detections * 2, 100, 100, "primary")["mpi_proxy"], 60)
        self.assertIsNone(score_detections([], 100, 100)["pci_proxy"])

    def test_dataset_filter_decodes_pixels_and_validates_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "source", Path(directory) / "clean"
            images, labels = source / "train/images", source / "train/labels"
            images.mkdir(parents=True)
            labels.mkdir(parents=True)
            image = Image.new("RGB", (16, 16), "white")
            for name in ("valid", "background", "invalid"):
                image.save(images / f"{name}.jpg")
            (images / "corrupt.jpg").write_bytes(b"not a JPEG")
            (labels / "valid.txt").write_text("4 0.5 0.5 0.25 0.25\n")
            (labels / "invalid.txt").write_text("4 1.5 0.5 0.25 0.25\n")
            stats = filter_dataset(source, output)
            self.assertEqual(stats, {"raw_images": 4, "corrupt_images": 1,
                "background_images": 1, "invalid_labels": 1, "retained_images": 1})
            self.assertTrue((output / "train/images/valid.jpg").is_file())


class ApiPipelineTests(unittest.TestCase):
    def test_upload_is_persisted_and_dashboard_updates(self):
        with tempfile.TemporaryDirectory() as directory:
            os.environ["DATABASE_URL"] = f"sqlite:///{(Path(directory) / 'test.sqlite3').as_posix()}"
            from backend import main
            from backend.database import engine

            def enable_foreign_keys(connection, _record):
                connection.execute("PRAGMA foreign_keys=ON")

            event.listen(engine, "connect", enable_foreign_keys)

            previous_upload, previous_annotated = main.UPLOAD_DIR, main.ANNOTATED_DIR
            main.UPLOAD_DIR = Path(directory) / "uploads"
            main.ANNOTATED_DIR = Path(directory) / "annotated"
            try:
                with TestClient(main.app) as client:
                    before = client.get("/api/dashboard")
                    self.assertEqual(before.status_code, 200)
                    reported = client.get("/api/model/metrics").json()["metrics"]
                    self.assertTrue(reported["reported"])
                    self.assertEqual(reported["map50"], 0.62)
                    self.assertEqual(reported["fused_parameters"], 11127519)
                    self.assertEqual(len(reported["per_class"]), 5)
                    image = Image.new("RGB", (64, 64), "white")
                    buffer = io.BytesIO()
                    image.save(buffer, format="JPEG")
                    response = client.post("/api/damage/analyze", files={"file": ("road.jpg", buffer.getvalue(), "image/jpeg")})
                    self.assertEqual(response.status_code, 200, response.text)
                    result = response.json()
                    self.assertEqual(result["location_status"], "no_gps")
                    self.assertIsNone(result["road_id"])
                    self.assertFalse(main.UPLOAD_DIR.exists())
                    from backend.database import ImageAsset
                    with main.get_session() as session:
                        asset = session.get(ImageAsset, result["id"])
                        self.assertEqual(asset.original_bytes, buffer.getvalue())
                        self.assertTrue(asset.annotated_bytes.startswith(b"\xff\xd8"))
                    self.assertEqual(client.get(f"/api/detections/{result['id']}/original").content, buffer.getvalue())
                    self.assertEqual(client.get(f"/api/detections/{result['id']}/image").headers["content-type"], "image/jpeg")
                    saved = client.get(f"/api/detections/{result['id']}")
                    self.assertEqual(saved.status_code, 200)
                    self.assertEqual(saved.json()["detections"], result["detections"])
                    history = client.get("/api/detections?limit=1&query=road.jpg").json()
                    self.assertEqual(history["total"], 1)
                    self.assertEqual(history["records"][0]["id"], result["id"])
                    self.assertEqual(client.get("/api/detections?query=missing").json()["total"], 0)
                    observation_id = client.get("/api/observations").json()["records"][0]["id"]
                    self.assertEqual(client.post(f"/api/observations/{observation_id}/recheck-location").status_code, 422)
                    after = client.get("/api/dashboard")
                    self.assertEqual(after.json()["uploaded_images"], before.json()["uploaded_images"] + 1)
                    self.assertEqual(after.json()["detections"], len(result["detections"]))
                    stats = client.get("/api/dashboard/stats")
                    self.assertEqual(stats.status_code, 200)
                    self.assertEqual(stats.json()["images_processed"], 1)
                    queue = client.get("/api/observations")
                    self.assertEqual(queue.status_code, 200)
                    self.assertEqual(queue.json()["records"][0]["filename"], "road.jpg")
                    self.assertEqual(client.get("/api/map").json()["features"], [])
                    self.assertEqual(client.get("/api/observations?priority=invalid").status_code, 422)
                    exif = Image.Exif()
                    exif[ExifTags.IFD.GPSInfo] = {
                        1: "N", 2: (12.0, 58.0, 25.458),
                        3: "E", 4: (77.0, 36.0, 50.009),
                    }
                    gps_buffer = io.BytesIO()
                    image.save(gps_buffer, format="JPEG", exif=exif)
                    located = client.post("/api/upload?include_annotated_image=false", files={"file": ("gps.jpg", gps_buffer.getvalue(), "image/jpeg")})
                    self.assertEqual(located.status_code, 200, located.text)
                    self.assertEqual(located.json()["location_status"], "road_snapped")
                    self.assertEqual(located.json()["location_source"], "exif")
                    self.assertIsNone(located.json()["annotated_image"])
                    self.assertEqual(client.get(located.json()["annotated_image_url"]).status_code, 200)
                    self.assertEqual(client.get("/api/dashboard/stats").json()["matched_observations"], 1)
                    self.assertEqual(len(client.get("/api/map").json()["features"]), 1)
                    gps_observation_id = client.get("/api/observations").json()["records"][0]["id"]
                    rechecked = client.post(f"/api/observations/{gps_observation_id}/recheck-location")
                    self.assertEqual(rechecked.status_code, 200, rechecked.text)
                    self.assertEqual(rechecked.json()["location_source"], "exif")
                    from backend.database import DetectionRecord, persist_observation
                    point = snap_to_road(12.973738429220642, 77.6138913631439)
                    damages = [
                        {"class_id": 4, "class_name": "D40_Pothole", "confidence": 0.9,
                         "bbox": [0, 0, 10, 10]} for _ in range(2)
                    ]
                    score = score_detections(damages, 64, 64, point["road_type"])
                    synthetic_path = Path(directory) / "scored.jpg"
                    synthetic_path.write_bytes(buffer.getvalue())
                    with main.get_session() as session:
                        record = DetectionRecord(
                            original_filename="scored.jpg", image_path=str(synthetic_path),
                            annotated_image_path=str(synthetic_path), detection_count=2,
                            detections=damages, inference_ms=1.0,
                            latitude=12.973738429220642, longitude=77.6138913631439,
                            **point, **score,
                        )
                        session.add(record)
                        session.flush()
                        persist_observation(session, record, json.dumps(road_geometry(record.road_id)))
                        session.commit()
                    feature = client.get("/api/map").json()["features"][0]
                    self.assertEqual(feature["properties"]["pci_score"], 60)
                    self.assertEqual(feature["properties"]["mpi_score"], 40)
                    self.assertEqual(feature["properties"]["priority"], "Medium")
                    self.assertEqual(len(client.get("/api/observations?priority=Medium").json()["records"]), 1)
                    with patch.dict(os.environ, {"ROAD_RESILIENCE_DELETE_KEY": "test-delete-key"}):
                        delete_url = f"/api/detections/{record.id}"
                        self.assertEqual(client.delete(delete_url).status_code, 403)
                        self.assertEqual(client.delete(delete_url, headers={"X-Delete-Key": "wrong"}).status_code, 403)
                        authorized = {"X-Delete-Key": "test-delete-key"}
                        self.assertEqual(client.delete(delete_url, headers=authorized).status_code, 200)
                        self.assertEqual(client.get(delete_url).status_code, 404)
                        self.assertEqual(len(client.get("/api/map").json()["features"]), 1)
                        self.assertEqual(client.delete(delete_url, headers=authorized).status_code, 404)
                        gps_url = f"/api/detections/{located.json()['id']}"
                        self.assertEqual(client.delete(gps_url, headers=authorized).status_code, 200)
                        self.assertEqual(client.get(gps_url + "/original").status_code, 404)
                        self.assertEqual(client.get("/api/map").json()["features"], [])
                        self.assertEqual(client.get("/api/dashboard/stats").json()["matched_observations"], 0)
                        self.assertEqual(client.delete(f"/api/detections/{result['id']}", headers=authorized).status_code, 200)
                        self.assertEqual(client.get("/api/dashboard/stats").json()["images_processed"], 0)
                        self.assertEqual(client.get("/api/detections").json()["total"], 0)
                        # Mapillary thumbnails have no EXIF: API coordinates and attribution must survive inference.
                        metadata = {
                            "id": "123456789", "latitude": 12.973738429220642, "longitude": 77.6138913631439,
                            "source_metadata": {
                                "provider": "mapillary", "image_id": "123456789",
                                "image_url": "https://www.mapillary.com/app/?pKey=123456789",
                                "creator_username": "contributor", "creator_id": "123",
                                "creator_url": "https://www.mapillary.com/app/user/contributor",
                                "captured_at": 1600000000000, "coordinate_source": "computed_geometry",
                                "license": "CC BY-SA 4.0", "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
                            },
                        }
                        box = Mock()
                        box.xyxy = [Mock()]
                        box.xyxy[0].tolist.return_value = [1.0, 1.0, 40.0, 40.0]
                        box.cls, box.conf = [Mock()], [Mock()]
                        box.cls[0].item.return_value = 4
                        box.conf[0].item.return_value = 0.9
                        detector = Mock(names={4: "D40_Pothole"})
                        detector.predict.return_value = [Mock(boxes=[box])]
                        with patch.object(main.mapillary_client, "download_image", return_value=(buffer.getvalue(), "image/jpeg", metadata)) as download, patch.object(main, "load_model", return_value=detector), patch.object(main, "extract_image_location", side_effect=AssertionError("Should use Mapillary coordinates")):
                            imported = client.post("/api/mapillary/analyze", json={"image_id": "123456789"})
                            self.assertEqual(imported.status_code, 200, imported.text)
                            analysis = imported.json()
                            self.assertEqual(analysis["location_source"], "mapillary")
                            self.assertEqual(analysis["location_status"], "road_snapped")
                            self.assertEqual(analysis["source_metadata"], metadata["source_metadata"])
                            self.assertEqual(analysis["priority"], "Low")
                            repeated = client.post("/api/mapillary/analyze", json={"image_id": "123456789"})
                            self.assertEqual(repeated.status_code, 200, repeated.text)
                            self.assertEqual(repeated.json()["id"], analysis["id"])
                            self.assertTrue(repeated.json()["reused"])
                            download.assert_called_once()
                            observation = client.get("/api/observations").json()["records"][0]
                            self.assertEqual(observation["source_metadata"], metadata["source_metadata"])
                            with patch.object(main.mapillary_client, "get_image", return_value=metadata):
                                self.assertEqual(client.post(f"/api/observations/{observation['id']}/recheck-location").status_code, 200)
                            saved = client.get(f"/api/detections/{analysis['id']}").json()
                            self.assertEqual(saved["source_type"], "mapillary")
                            self.assertEqual(saved["latitude"], metadata["latitude"])
                            self.assertEqual(client.get("/api/detections").json()["records"][0]["source_metadata"], metadata["source_metadata"])
                            self.assertEqual(client.get("/api/dashboard").json()["history"][0]["source"], "mapillary_inference")
                            self.assertEqual(len(client.get("/api/map").json()["features"]), 1)
                            self.assertEqual(client.delete(f"/api/detections/{analysis['id']}", headers=authorized).status_code, 200)
                            self.assertEqual(client.get("/api/map").json()["features"], [])
            finally:
                main.UPLOAD_DIR, main.ANNOTATED_DIR = previous_upload, previous_annotated
                engine.dispose()
                event.remove(engine, "connect", enable_foreign_keys)


if __name__ == "__main__":
    unittest.main()
