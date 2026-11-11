"""Import publicly shared Google Drive images without fetching arbitrary URLs."""

import io
import os
import re
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from PIL import Image, UnidentifiedImageError


MAX_DRIVE_BYTES = 15 * 1024 * 1024
DRIVE_ID = re.compile(r"^[A-Za-z0-9_-]{10,}$")
RESOURCE_KEY = re.compile(r"^[A-Za-z0-9_-]+$")
IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff", "image/gif"}
FORMAT_MIMES = {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"), "WEBP": ("webp", "image/webp"), "BMP": ("bmp", "image/bmp"), "TIFF": ("tiff", "image/tiff"), "GIF": ("gif", "image/gif")}
ALLOWED_DOWNLOAD_HOSTS = {"drive.google.com", "drive.usercontent.google.com", "www.googleapis.com"}


class DriveImportError(ValueError):
    pass


def parse_drive_link(link: str) -> tuple[str, str, str | None]:
    try:
        parsed = urlparse(link.strip())
        if parsed.scheme != "https" or parsed.hostname not in {"drive.google.com", "www.drive.google.com"}:
            raise DriveImportError("Paste an HTTPS Google Drive sharing link.")
        parts = [part for part in parsed.path.split("/") if part]
        kind = "folder" if "folders" in parts else "file"
        if kind == "folder":
            index = parts.index("folders")
            item_id = parts[index + 1]
        elif "d" in parts:
            index = parts.index("d")
            item_id = parts[index + 1]
        else:
            item_id = parse_qs(parsed.query).get("id", [""])[0]
        resource_key = parse_qs(parsed.query).get("resourcekey", [None])[0]
        if not DRIVE_ID.fullmatch(item_id) or (resource_key and not RESOURCE_KEY.fullmatch(resource_key)):
            raise DriveImportError("This is not a valid Google Drive file or folder link.")
        return kind, item_id, resource_key
    except (IndexError, ValueError) as exc:
        if isinstance(exc, DriveImportError):
            raise
        raise DriveImportError("This is not a valid Google Drive file or folder link.") from exc


def _request_google(url: str, *, params: dict | None = None, headers: dict | None = None) -> requests.Response:
    """Follow only known Google download hosts and leave the body streamed."""
    for _ in range(6):
        parsed = urlparse(url)
        host = parsed.hostname or ""
        if parsed.scheme != "https" or (host not in ALLOWED_DOWNLOAD_HOSTS and not host.endswith(".googleusercontent.com")):
            raise DriveImportError("Google Drive redirected to an unsupported download host.")
        try:
            response = requests.get(url, params=params, headers=headers, timeout=(5, 30), stream=True, allow_redirects=False)
        except requests.RequestException as exc:
            raise DriveImportError("Google Drive could not be reached.") from exc
        if response.is_redirect:
            location = response.headers.get("Location")
            response.close()
            if not location:
                raise DriveImportError("Google Drive returned an incomplete redirect.")
            url = urljoin(url, location)
            params = None
            headers = None
            continue
        return response
    raise DriveImportError("Google Drive redirected too many times.")


def list_folder_images(link: str) -> list[dict[str, str]]:
    kind, folder_id, resource_key = parse_drive_link(link)
    if kind != "folder":
        raise DriveImportError("Paste a Google Drive folder link to add its images.")
    api_key = os.getenv("GOOGLE_DRIVE_API_KEY")
    if not api_key:
        raise DriveImportError("Drive folder import needs GOOGLE_DRIVE_API_KEY configured on the API server.")
    headers = {"X-Goog-Api-Key": api_key}
    if resource_key:
        headers["X-Goog-Drive-Resource-Keys"] = f"{folder_id}/{resource_key}"
    results: list[dict[str, str]] = []
    page_token = None
    while True:
        params = {
            "q": f"'{folder_id}' in parents and trashed = false",
            "fields": "nextPageToken,files(id,name,mimeType,resourceKey)",
            "pageSize": 100, "supportsAllDrives": "true", "includeItemsFromAllDrives": "true",
        }
        if page_token:
            params["pageToken"] = page_token
        response = _request_google("https://www.googleapis.com/drive/v3/files", params=params, headers=headers)
        try:
            if response.status_code != 200:
                raise DriveImportError("Could not list this folder. Set it to Anyone with the link and check the Drive API key.")
            data = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise DriveImportError("Google Drive returned an invalid folder listing.") from exc
        finally:
            response.close()
        for item in data.get("files", []):
            if item.get("mimeType") not in IMAGE_MIMES or not DRIVE_ID.fullmatch(item.get("id", "")):
                continue
            file_link = f"https://drive.google.com/file/d/{item['id']}/view"
            if item.get("resourceKey"):
                file_link += f"?resourcekey={item['resourceKey']}"
            results.append({"name": item.get("name") or item["id"], "link": file_link})
            if len(results) >= 200:
                return results
        page_token = data.get("nextPageToken")
        if not page_token:
            return results


def download_image(link: str) -> tuple[bytes, str, str]:
    kind, file_id, resource_key = parse_drive_link(link)
    if kind != "file":
        raise DriveImportError("Use a Drive image file link; add folder links to the queue first.")
    api_key = os.getenv("GOOGLE_DRIVE_API_KEY")
    if api_key:
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}"
        params = {"alt": "media"}
        headers = {"X-Goog-Api-Key": api_key}
        if resource_key:
            headers["X-Goog-Drive-Resource-Keys"] = f"{file_id}/{resource_key}"
    else:
        url = "https://drive.google.com/uc"
        params = {"export": "download", "id": file_id, "confirm": "t"}
        headers = None
    response = _request_google(url, params=params, headers=headers)
    try:
        if response.status_code != 200:
            raise DriveImportError("Could not download this image. Set its Drive access to Anyone with the link.")
        content = bytearray()
        for chunk in response.iter_content(chunk_size=65536):
            content.extend(chunk)
            if len(content) > MAX_DRIVE_BYTES:
                raise DriveImportError("Drive image exceeds the 15 MB limit.")
        if not content:
            raise DriveImportError("The Drive image is empty.")
        try:
            with Image.open(io.BytesIO(content)) as image:
                extension, mime = FORMAT_MIMES[image.format or ""]
                image.verify()
        except (UnidentifiedImageError, KeyError, OSError) as exc:
            raise DriveImportError("Drive returned a web page or unsupported file instead of an image.") from exc
        return bytes(content), f"drive-{file_id}.{extension}", mime
    except requests.RequestException as exc:
        raise DriveImportError("Google Drive image download failed.") from exc
    finally:
        response.close()
