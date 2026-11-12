"""Bounded Mapillary Graph API searches and trusted imagery downloads."""

from __future__ import annotations

import io
import logging
import math
import os
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, urljoin, urlparse

import requests
from PIL import Image, UnidentifiedImageError


GRAPH_URL = "https://graph.mapillary.com"
MAX_IMAGE_BYTES = 15 * 1024 * 1024
IMAGE_FIELDS = "id,geometry,computed_geometry,captured_at,creator,thumb_256_url,thumb_1024_url,is_pano"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
logger = logging.getLogger("road_resilience.mapillary")


class MapillaryError(ValueError):
    def __init__(self, message: str, status_code: int = 502, retryable: bool = False):
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable


def configured() -> bool:
    return bool(os.getenv("MAPILLARY_ACCESS_TOKEN", "").strip())


def _image_id(image_id: str) -> str:
    if not re.fullmatch(r"[0-9]{1,30}", image_id):
        raise MapillaryError("Invalid Mapillary image ID.", 422)
    return image_id


def validate_bbox(bbox: tuple[float, float, float, float]) -> None:
    if len(bbox) != 4 or not all(math.isfinite(value) for value in bbox):
        raise MapillaryError("Choose a valid map area.", 422)
    west, south, east, north = bbox
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise MapillaryError("Choose a valid map area.", 422)
    if east - west > 0.100000001 or north - south > 0.100000001:
        raise MapillaryError("Zoom in to search a smaller map area (up to 0.1 degrees per side).", 422)


def _graph(path: str, params: dict | None = None, *, read_timeout: int = 30) -> dict:
    token = os.getenv("MAPILLARY_ACCESS_TOKEN", "").strip()
    if not token:
        raise MapillaryError("Mapillary is not connected. Ask the administrator to configure its access token.", 503)
    try:
        response = requests.get(
            f"{GRAPH_URL}/{path}", params=params,
            headers={"Authorization": f"OAuth {token}"}, timeout=(5, read_timeout), allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise MapillaryError("Mapillary could not be reached. Please try again.", retryable=isinstance(exc, requests.Timeout)) from exc
    try:
        if response.status_code != 200:
            # Provider messages can contain request credentials; record only safe numeric diagnostics.
            provider_code = None
            try:
                body = response.json()
                error = body.get("error") if isinstance(body, dict) else None
                if isinstance(error, dict) and isinstance(error.get("code"), int):
                    provider_code = error["code"]
            except ValueError:
                pass
            logger.warning("Mapillary Graph error: HTTP %s, provider code %s", response.status_code, provider_code)
            if provider_code in {102, 190}:
                raise MapillaryError("Mapillary rejected the access token. Check the server's Mapillary connection.", 503)
        if response.status_code in {401, 403}:
            raise MapillaryError("Mapillary rejected the access token. Check the server's Mapillary connection.", 503)
        if response.status_code == 404:
            raise MapillaryError("This Mapillary image is no longer available.", 404)
        if response.status_code == 429:
            raise MapillaryError("Mapillary's request limit was reached. Please wait and try again.", 429)
        if response.status_code != 200:
            raise MapillaryError("Mapillary could not complete the request. Please try again.", retryable=response.status_code >= 500 or provider_code == 1)
        data = response.json()
        if not isinstance(data, dict) or "error" in data:
            raise MapillaryError("Mapillary returned an invalid response.")
        return data
    except (requests.RequestException, ValueError) as exc:
        if isinstance(exc, MapillaryError):
            raise
        raise MapillaryError("Mapillary returned an invalid response.") from exc
    finally:
        response.close()


def _trusted_image_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        host = parsed.hostname or ""
        return (
            parsed.scheme == "https" and not parsed.username and not parsed.password
            and parsed.port in {None, 443}
            and (host.endswith(".fbcdn.net") or host.endswith(".fbsbx.com") or host == "images.mapillary.com")
        )
    except ValueError:
        return False


def _normalize(item: dict) -> dict:
    image_id = _image_id(str(item.get("id", "")))
    location = None
    coordinate_source = None
    for key in ("computed_geometry", "geometry"):
        geometry = item.get(key)
        coordinates = geometry.get("coordinates") if isinstance(geometry, dict) and geometry.get("type") == "Point" else None
        if not isinstance(coordinates, (list, tuple)) or len(coordinates) < 2:
            continue
        try:
            longitude, latitude = float(coordinates[0]), float(coordinates[1])
        except (TypeError, ValueError):
            continue
        if math.isfinite(longitude) and math.isfinite(latitude) and -180 <= longitude <= 180 and -90 <= latitude <= 90:
            location, coordinate_source = (longitude, latitude), key
            break
    if location is None:
        raise MapillaryError("This Mapillary image has no usable coordinates.", 422)
    download_url = item.get("thumb_1024_url")
    thumbnail_url = item.get("thumb_256_url") or download_url
    if not isinstance(download_url, str) or not _trusted_image_url(download_url):
        raise MapillaryError("This Mapillary image has no supported download URL.", 422)
    if not isinstance(thumbnail_url, str) or not _trusted_image_url(thumbnail_url):
        thumbnail_url = download_url
    creator = item.get("creator") if isinstance(item.get("creator"), dict) else {}
    username = str(creator.get("username") or "")[:255] or None
    creator_id = str(creator.get("id") or "")[:50] or None
    captured_at = item.get("captured_at")
    if not isinstance(captured_at, (int, float)) or not math.isfinite(captured_at) or captured_at < 0:
        captured_at = None
    image_url = f"https://www.mapillary.com/app/?pKey={image_id}"
    source_metadata = {
        "provider": "mapillary", "image_id": image_id, "image_url": image_url,
        "creator_username": username, "creator_id": creator_id,
        "creator_url": f"https://www.mapillary.com/app/user/{quote(username, safe='')}" if username else None,
        "captured_at": captured_at, "coordinate_source": coordinate_source,
        "license": "CC BY-SA 4.0", "license_url": LICENSE_URL,
    }
    return {
        "id": image_id, "latitude": location[1], "longitude": location[0],
        "captured_at": captured_at, "creator_username": username, "creator_id": creator_id,
        "thumbnail_url": thumbnail_url, "image_url": image_url,
        "is_pano": bool(item.get("is_pano")), "download_url": download_url,
        "source_metadata": source_metadata,
    }


def _search_box(bbox: tuple[float, float, float, float], limit: int) -> list[dict]:
    data = _graph("images", {"bbox": ",".join(str(value) for value in bbox), "fields": IMAGE_FIELDS, "limit": limit}, read_timeout=15)
    if not isinstance(data.get("data"), list):
        raise MapillaryError("Mapillary returned an invalid image list.")
    images = []
    seen: set[str] = set()
    for item in data["data"][:limit]:
        if not isinstance(item, dict):
            continue
        try:
            normalized = _normalize(item)
        except MapillaryError:
            continue
        if normalized["id"] in seen:
            continue
        seen.add(normalized["id"])
        # The short-lived full-size download URL is only used by the backend.
        normalized.pop("download_url")
        images.append(normalized)
    return images


def _search_parts(bbox: tuple[float, float, float, float], limit: int) -> dict:
    west, south, east, north = bbox
    middle_x, middle_y = (west + east) / 2, (south + north) / 2
    parts = [
        (west, south, middle_x, middle_y), (middle_x, south, east, middle_y),
        (west, middle_y, middle_x, north), (middle_x, middle_y, east, north),
    ]
    per_part = math.ceil(limit / len(parts))
    images: list[dict] = []
    failed = 0
    seen: set[str] = set()
    # Bounded parallel calls avoid making the user wait for four sequential provider requests.
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(_search_box, part, per_part) for part in parts]
        for future in futures:
            try:
                result = future.result()
            except MapillaryError as exc:
                if not exc.retryable:
                    raise
                failed += 1
                continue
            for image in result:
                if image["id"] in seen or not (west <= image["longitude"] <= east and south <= image["latitude"] <= north):
                    continue
                seen.add(image["id"])
                images.append(image)
    if failed == len(parts):
        raise MapillaryError("Mapillary timed out while searching this area. Zoom in to a shorter road section and search again.", 503, retryable=True)
    return {
        "images": images[:limit], "partial": failed > 0,
        "warning": "Some images could not be loaded from this area. Zoom in and search again to check the rest." if failed else None,
    }


def search_area(bbox: tuple[float, float, float, float], limit: int = 24) -> dict:
    validate_bbox(bbox)
    limit = max(1, min(limit, 50))
    west, south, east, north = bbox
    # Dense spatial queries can hit Mapillary's hard timeout even with a small result limit.
    if east - west > 0.025000001 or north - south > 0.025000001:
        return _search_parts(bbox, limit)
    try:
        return {"images": _search_box(bbox, limit), "partial": False, "warning": None}
    except MapillaryError as exc:
        if not exc.retryable:
            raise
        return _search_parts(bbox, limit)


def search_images(bbox: tuple[float, float, float, float], limit: int = 24) -> list[dict]:
    return search_area(bbox, limit)["images"]


def get_image(image_id: str) -> dict:
    image_id = _image_id(image_id)
    result = _normalize(_graph(image_id, {"fields": IMAGE_FIELDS}))
    if result["id"] != image_id:
        raise MapillaryError("Mapillary returned a different image than requested.")
    return result


def download_image(image_id: str) -> tuple[bytes, str, dict]:
    metadata = get_image(image_id)  # Refresh expiring CDN URLs; never accept a URL from the caller.
    url = metadata["download_url"]
    for _ in range(5):
        if not _trusted_image_url(url):
            raise MapillaryError("Mapillary returned an unsupported image host.")
        try:
            response = requests.get(url, timeout=(5, 30), stream=True, allow_redirects=False)
        except requests.RequestException as exc:
            raise MapillaryError("The Mapillary image could not be downloaded.") from exc
        try:
            if response.is_redirect:
                url = urljoin(url, response.headers.get("Location", ""))
                continue
            if response.status_code != 200:
                raise MapillaryError("The Mapillary image is unavailable. Search again to refresh the imagery.")
            content = bytearray()
            for chunk in response.iter_content(chunk_size=65536):
                content.extend(chunk)
                if len(content) > MAX_IMAGE_BYTES:
                    raise MapillaryError("The Mapillary image exceeds the 15 MB limit.", 413)
            try:
                with Image.open(io.BytesIO(content)) as image:
                    mime = Image.MIME.get(image.format or "")
                    image.verify()
                if mime not in {"image/jpeg", "image/png", "image/webp"}:
                    raise ValueError("Unsupported image type")
            except (ValueError, OSError, UnidentifiedImageError) as exc:
                raise MapillaryError("Mapillary returned an unreadable image.") from exc
            return bytes(content), mime, metadata
        except requests.RequestException as exc:
            raise MapillaryError("The Mapillary image download was interrupted.") from exc
        finally:
            response.close()
    raise MapillaryError("Mapillary redirected the download too many times.")
