"""Mapillary imports keep provider metadata and constrain server-side downloads."""

import io
import json
import os
import unittest
from unittest.mock import Mock, patch

import requests
from PIL import Image

from backend import mapillary_client as mapillary


class MapillaryClientTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {"MAPILLARY_ACCESS_TOKEN": "private-test-token"})
        environment.start()
        self.addCleanup(environment.stop)

    @staticmethod
    def image_metadata(**overrides):
        metadata = {
            "id": "123456789", "geometry": {"type": "Point", "coordinates": [77.61, 12.97]},
            "computed_geometry": {"type": "Point", "coordinates": [77.612, 12.973]},
            "captured_at": 1700000000000, "creator": {"id": "987", "username": "road engineer"},
            "thumb_256_url": "https://scontent.example.fbcdn.net/preview.jpg?signature=preview",
            "thumb_1024_url": "https://scontent.example.fbcdn.net/image.jpg?signature=download",
            "is_pano": False,
        }
        metadata.update(overrides)
        return metadata

    @staticmethod
    def response(data=None, status=200, content=None, redirect=None):
        response = Mock(spec=requests.Response)
        response.status_code = status
        response.is_redirect = redirect is not None
        response.headers = {"Location": redirect} if redirect is not None else {}
        response.json.return_value = data
        response.iter_content.return_value = [content] if content is not None else []
        return response

    def test_unconfigured_client_does_not_make_network_request(self):
        with patch.dict(os.environ, {"MAPILLARY_ACCESS_TOKEN": " "}), patch.object(mapillary.requests, "get") as get:
            self.assertFalse(mapillary.configured())
            with self.assertRaises(mapillary.MapillaryError) as caught:
                mapillary.search_images((77.60, 12.96, 77.62, 12.98))
            self.assertEqual(caught.exception.status_code, 503)
            get.assert_not_called()

    def test_search_uses_bbox_order_and_header_auth_and_returns_attribution(self):
        response = self.response({"data": [self.image_metadata()]})
        with patch.object(mapillary.requests, "get", return_value=response) as get:
            images = mapillary.search_images((77.60, 12.96, 77.62, 12.98), limit=999)
        self.assertEqual(get.call_args.args[0], "https://graph.mapillary.com/images")
        kwargs = get.call_args.kwargs
        self.assertEqual(kwargs["params"]["bbox"], "77.6,12.96,77.62,12.98")
        self.assertEqual(kwargs["params"]["limit"], 50)
        self.assertEqual(kwargs["headers"]["Authorization"], "OAuth private-test-token")
        self.assertNotIn("access_token", kwargs["params"])
        self.assertFalse(kwargs["allow_redirects"])
        self.assertEqual((images[0]["latitude"], images[0]["longitude"]), (12.973, 77.612))
        source = images[0]["source_metadata"]
        self.assertEqual(source["coordinate_source"], "computed_geometry")
        self.assertEqual(source["captured_at"], 1700000000000)
        self.assertEqual(source["creator_username"], "road engineer")
        self.assertIn("road%20engineer", source["creator_url"])
        self.assertEqual(source["license"], "CC BY-SA 4.0")
        self.assertEqual(source["license_url"], "https://creativecommons.org/licenses/by-sa/4.0/")
        self.assertNotIn("download_url", images[0])
        self.assertNotIn("private-test-token", json.dumps(images))
        response.close.assert_called_once()

    def test_invalid_bbox_rejected_before_network(self):
        invalid = [
            (77.6, 12.9, 77.5, 13.0), (77.6, 13.0, 77.7, 12.9),
            (-181.0, 12.0, -180.99, 12.01), (77.6, 90.0, 77.61, 90.01),
            (77.6, 12.9, 77.8, 12.91), (77.6, float("nan"), 77.61, 12.91),
        ]
        with patch.object(mapillary.requests, "get") as get:
            for bbox in invalid:
                with self.subTest(bbox=bbox), self.assertRaises(mapillary.MapillaryError) as caught:
                    mapillary.search_images(bbox)
                self.assertEqual(caught.exception.status_code, 422)
            get.assert_not_called()

    def test_exact_maximum_bbox_span_is_accepted(self):
        mapillary.validate_bbox((77.6, 12.9, 77.7, 13.0))

    def test_search_skips_missing_coordinates_and_duplicates(self):
        missing = self.image_metadata(id="222", geometry=None, computed_geometry=None)
        fallback = self.image_metadata(id="333", computed_geometry={"type": "Point", "coordinates": ["bad", 12.97]})
        response = self.response({"data": [missing, None, fallback, fallback]})
        with patch.object(mapillary.requests, "get", return_value=response):
            images = mapillary.search_images((77.60, 12.96, 77.62, 12.98))
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0]["id"], "333")
        self.assertEqual(images[0]["source_metadata"]["coordinate_source"], "geometry")
        self.assertEqual(images[0]["longitude"], 77.61)

    def test_invalid_or_mismatched_image_ids_are_rejected(self):
        with patch.object(mapillary.requests, "get") as get:
            for image_id in ("../images", "https://example.com/image", "abc", "123?access_token=x"):
                with self.subTest(image_id=image_id), self.assertRaises(mapillary.MapillaryError):
                    mapillary.get_image(image_id)
            get.assert_not_called()
        with patch.object(mapillary.requests, "get", return_value=self.response(self.image_metadata(id="987"))):
            with self.assertRaisesRegex(mapillary.MapillaryError, "different image"):
                mapillary.get_image("123456789")

    def test_upstream_errors_are_sanitized(self):
        expired = self.response({"error": {"code": 190, "message": "private-test-token"}}, status=400)
        with patch.object(mapillary.requests, "get", return_value=expired), self.assertLogs(mapillary.logger, level="WARNING") as logs:
            with self.assertRaises(mapillary.MapillaryError) as caught:
                mapillary.get_image("123456789")
            self.assertEqual(caught.exception.status_code, 503)
            self.assertNotIn("private-test-token", " ".join(logs.output))
        for status, expected in ((401, 503), (403, 503), (404, 404), (429, 429), (500, 502)):
            with self.subTest(status=status), patch.object(mapillary.requests, "get", return_value=self.response({"error": "private-test-token"}, status=status)):
                with self.assertRaises(mapillary.MapillaryError) as caught:
                    mapillary.get_image("123456789")
                self.assertEqual(caught.exception.status_code, expected)
                self.assertNotIn("private-test-token", str(caught.exception))
        with patch.object(mapillary.requests, "get", side_effect=requests.Timeout("private-test-token")):
            with self.assertRaises(mapillary.MapillaryError) as caught:
                mapillary.get_image("123456789")
            self.assertNotIn("private-test-token", str(caught.exception))

    def test_download_keeps_provider_coordinates_without_image_exif(self):
        buffer = io.BytesIO()
        Image.new("RGB", (4, 4), "white").save(buffer, format="JPEG")
        jpeg = buffer.getvalue()
        self.assertFalse(Image.open(io.BytesIO(jpeg)).getexif())
        responses = [self.response(self.image_metadata()), self.response(content=jpeg)]
        with patch.object(mapillary.requests, "get", side_effect=responses) as get:
            content, mime, metadata = mapillary.download_image("123456789")
        self.assertEqual((content, mime), (jpeg, "image/jpeg"))
        self.assertEqual((metadata["latitude"], metadata["longitude"]), (12.973, 77.612))
        self.assertEqual(metadata["source_metadata"]["provider"], "mapillary")
        download_call = get.call_args_list[1]
        self.assertNotIn("headers", download_call.kwargs)
        self.assertFalse(download_call.kwargs["allow_redirects"])
        for response in responses:
            response.close.assert_called_once()

    def test_download_rejects_untrusted_urls_and_redirects(self):
        for url in ("http://images.mapillary.com/image.jpg", "https://scontent.fbcdn.net.evil.example/image.jpg", "https://127.0.0.1/image.jpg", "https://user:password@images.mapillary.com/image.jpg", "https://images.mapillary.com:8443/image.jpg"):
            response = self.response(self.image_metadata(thumb_1024_url=url))
            with self.subTest(url=url), patch.object(mapillary.requests, "get", return_value=response) as get:
                with self.assertRaises(mapillary.MapillaryError):
                    mapillary.download_image("123456789")
                self.assertEqual(get.call_count, 1)
        responses = [self.response(self.image_metadata()), self.response(redirect="http://127.0.0.1/private")]
        with patch.object(mapillary.requests, "get", side_effect=responses) as get:
            with self.assertRaisesRegex(mapillary.MapillaryError, "unsupported image host"):
                mapillary.download_image("123456789")
            self.assertEqual(get.call_count, 2)
        responses[1].close.assert_called_once()

    def test_download_size_and_content_are_checked(self):
        responses = [self.response(self.image_metadata()), self.response(content=b"x" * 9)]
        with patch.object(mapillary, "MAX_IMAGE_BYTES", 8), patch.object(mapillary.requests, "get", side_effect=responses):
            with self.assertRaises(mapillary.MapillaryError) as caught:
                mapillary.download_image("123456789")
            self.assertEqual(caught.exception.status_code, 413)
        responses = [self.response(self.image_metadata()), self.response(content=b"<html>not an image</html>")]
        with patch.object(mapillary.requests, "get", side_effect=responses):
            with self.assertRaisesRegex(mapillary.MapillaryError, "unreadable image"):
                mapillary.download_image("123456789")

    def test_area_search_subdivides_and_merges_without_duplicates_or_outside_points(self):
        bbox = (77.56, 12.96, 77.60, 13.00)

        def search_box(box, limit):
            west, south, east, north = box
            image_id = f"{west:.3f}:{south:.3f}"
            return [
                {"id": image_id, "longitude": (west + east) / 2, "latitude": (south + north) / 2},
                {"id": "same-image", "longitude": 77.58, "latitude": 12.98},
                {"id": "outside", "longitude": 78.0, "latitude": 14.0},
            ]

        with patch.object(mapillary, "_search_box", side_effect=search_box) as search:
            result = mapillary.search_area(bbox, limit=7)
        self.assertEqual(search.call_count, 4)
        self.assertEqual(len({call.args[0] for call in search.call_args_list}), 4)
        self.assertTrue(all(call.args[1] == 2 for call in search.call_args_list))
        self.assertLessEqual(len(result["images"]), 7)
        ids = [image["id"] for image in result["images"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("same-image", ids)
        self.assertNotIn("outside", ids)
        self.assertFalse(result["partial"])
        self.assertIsNone(result["warning"])

    def test_small_area_transient_failure_gets_one_bounded_subdivision(self):
        bbox = (77.60, 12.96, 77.62, 12.98)

        def search_box(box, limit):
            if box == bbox:
                raise mapillary.MapillaryError("Provider timed out", retryable=True)
            west, south, east, north = box
            return [{"id": f"{west:.3f}:{south:.3f}", "longitude": (west + east) / 2, "latitude": (south + north) / 2}]

        with patch.object(mapillary, "_search_box", side_effect=search_box) as search:
            result = mapillary.search_area(bbox, limit=4)
        self.assertEqual(search.call_count, 5)
        self.assertEqual(len(result["images"]), 4)
        self.assertFalse(result["partial"])

    def test_area_search_marks_partially_unavailable_subareas(self):
        bbox = (77.56, 12.96, 77.60, 13.00)

        def search_box(box, limit):
            west, south, east, north = box
            if west == bbox[0] and south == bbox[1]:
                raise mapillary.MapillaryError("Provider timed out", retryable=True)
            return [{"id": f"{west:.3f}:{south:.3f}", "longitude": (west + east) / 2, "latitude": (south + north) / 2}]

        with patch.object(mapillary, "_search_box", side_effect=search_box) as search:
            result = mapillary.search_area(bbox, limit=12)
        self.assertEqual(search.call_count, 4)
        self.assertEqual(len(result["images"]), 3)
        self.assertTrue(result["partial"])
        self.assertTrue(result["warning"])

    def test_all_failed_subareas_return_useful_error_instead_of_empty_success(self):
        with patch.object(mapillary, "_search_box", side_effect=mapillary.MapillaryError("Provider timed out", retryable=True)) as search:
            with self.assertRaises(mapillary.MapillaryError) as caught:
                mapillary.search_area((77.56, 12.96, 77.60, 13.00))
        self.assertEqual(search.call_count, 4)
        self.assertEqual(caught.exception.status_code, 503)

    def test_auth_and_rate_errors_are_not_retried_by_subdivision(self):
        for status in (503, 429):
            with self.subTest(status=status), patch.object(mapillary, "_search_box", side_effect=mapillary.MapillaryError("Connection rejected", status_code=status)) as search:
                with self.assertRaises(mapillary.MapillaryError) as caught:
                    mapillary.search_area((77.60, 12.96, 77.62, 12.98))
                self.assertEqual(search.call_count, 1)
                self.assertEqual(caught.exception.status_code, status)

    def test_provider_timeout_codes_are_retryable_but_bad_tokens_are_not(self):
        for status, code, expected in ((400, 1, True), (400, 100, False), (500, 1, True), (500, 190, False), (400, 102, False), (429, 4, False)):
            response = self.response({"error": {"code": code, "message": "private-test-token"}}, status=status)
            with self.subTest(status=status, code=code), patch.object(mapillary.requests, "get", return_value=response):
                with self.assertRaises(mapillary.MapillaryError) as caught:
                    mapillary.get_image("123456789")
                self.assertEqual(caught.exception.retryable, expected)
                self.assertNotIn("private-test-token", str(caught.exception))
        with patch.object(mapillary.requests, "get", side_effect=requests.ReadTimeout("private-test-token")):
            with self.assertRaises(mapillary.MapillaryError) as caught:
                mapillary.get_image("123456789")
            self.assertTrue(caught.exception.retryable)


if __name__ == "__main__":
    unittest.main()
