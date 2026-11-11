import io
import os
import unittest
from unittest.mock import Mock, patch

from PIL import Image

from backend.drive_import import DriveImportError, download_image, list_folder_images, parse_drive_link


class DriveImportTests(unittest.TestCase):
    def test_file_folder_links_and_rejected_hosts(self):
        self.assertEqual(parse_drive_link("https://drive.google.com/file/d/abcdefghij123/view?resourcekey=0-xyz"), ("file", "abcdefghij123", "0-xyz"))
        self.assertEqual(parse_drive_link("https://drive.google.com/drive/folders/abcdefghij123"), ("folder", "abcdefghij123", None))
        with self.assertRaises(DriveImportError):
            parse_drive_link("https://drive.google.com.evil.example/file/d/abcdefghij123/view")

    def test_public_folder_listing_and_image_filter(self):
        response = Mock(status_code=200, is_redirect=False)
        response.json.return_value = {"files": [
            {"id": "abcdefghij123", "name": "road.jpg", "mimeType": "image/jpeg", "resourceKey": "key1"},
            {"id": "otherfile123", "name": "notes.txt", "mimeType": "text/plain"},
        ]}
        with patch.dict(os.environ, {"GOOGLE_DRIVE_API_KEY": "test-key"}), patch("backend.drive_import.requests.get", return_value=response) as get:
            images = list_folder_images("https://drive.google.com/drive/folders/folder123456")
        self.assertEqual(images, [{"name": "road.jpg", "link": "https://drive.google.com/file/d/abcdefghij123/view?resourcekey=key1"}])
        self.assertEqual(get.call_args.kwargs["headers"]["X-Goog-Api-Key"], "test-key")
        with patch.dict(os.environ, {"GOOGLE_DRIVE_API_KEY": ""}):
            with self.assertRaisesRegex(DriveImportError, "GOOGLE_DRIVE_API_KEY"):
                list_folder_images("https://drive.google.com/drive/folders/folder123456")

    def test_image_download_is_size_limited(self):
        buffer = io.BytesIO()
        Image.new("RGB", (2, 2)).save(buffer, format="JPEG")
        jpeg = buffer.getvalue()
        response = Mock(status_code=200, is_redirect=False, headers={"Content-Type": "image/jpeg"})
        response.iter_content.return_value = [jpeg]
        with patch.dict(os.environ, {"GOOGLE_DRIVE_API_KEY": ""}), patch("backend.drive_import.requests.get", return_value=response):
            content, name, mime = download_image("https://drive.google.com/file/d/abcdefghij123/view")
        self.assertEqual((content, name, mime), (jpeg, "drive-abcdefghij123.jpg", "image/jpeg"))
        response.iter_content.return_value = [b"x" * (15 * 1024 * 1024 + 1)]
        with patch.dict(os.environ, {"GOOGLE_DRIVE_API_KEY": ""}), patch("backend.drive_import.requests.get", return_value=response):
            with self.assertRaisesRegex(DriveImportError, "15 MB"):
                download_image("https://drive.google.com/file/d/abcdefghij123/view")


if __name__ == "__main__":
    unittest.main()
