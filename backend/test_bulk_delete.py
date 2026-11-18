"""Checks for multi-selection deletion in saved analysis history."""

import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend import main
from backend.database import Base, DetectionRecord


class BulkDeleteTests(unittest.TestCase):
    def test_bulk_delete_requires_key_and_is_atomic(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        with Session(engine) as session:
            for name in ("first.jpg", "second.jpg"):
                session.add(DetectionRecord(
                    original_filename=name, image_path=name, annotated_image_path=name,
                    detection_count=0, detections=[], inference_ms=1.0,
                ))
            session.commit()
            ids = session.scalars(select(DetectionRecord.id).order_by(DetectionRecord.id)).all()

        with patch.dict(os.environ, {"ROAD_RESILIENCE_DELETE_KEY": "test-delete-key"}), \
                patch.object(main, "get_session", side_effect=lambda: Session(engine)):
            client = TestClient(main.app)
            url = "/api/detections/bulk-delete"
            valid_header = {"X-Delete-Key": "test-delete-key"}
            self.assertEqual(client.post(url, json={"ids": ids}).status_code, 403)
            self.assertEqual(client.post(url, json={"ids": ids}, headers={"X-Delete-Key": "wrong"}).status_code, 403)
            self.assertEqual(client.post(url, json={"ids": [ids[0], ids[0]]}, headers=valid_header).status_code, 422)
            self.assertEqual(client.post(url, json={"ids": [ids[0], 999]}, headers=valid_header).status_code, 404)
            with Session(engine) as session:
                self.assertEqual(len(session.scalars(select(DetectionRecord.id)).all()), 2)

            response = client.post(url, json={"ids": ids}, headers=valid_header)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), {"deleted_ids": ids, "count": 2})
            self.assertEqual(client.get("/api/detections").json()["total"], 0)
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
