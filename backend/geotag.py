"""Recover GPS coordinates from EXIF or a camera-app text stamp."""

from __future__ import annotations

import logging
import math
import re
from functools import lru_cache

import numpy as np
from PIL import Image

from backend.assessment import extract_gps


logger = logging.getLogger("road_resilience.geotag")
COORDINATE = r"([+-]?\d{1,3}[.,]\d{4,9})\s*[°º]?\s*([NSEW])?"
LATITUDE = re.compile(r"\bLat(?:itude)?\b\s*[:=]?\s*" + COORDINATE, re.IGNORECASE)
LONGITUDE = re.compile(r"\b(?:Lon(?:g(?:itude)?)?|Lng)\b\s*[:=]?\s*" + COORDINATE, re.IGNORECASE)


def parse_overlay_coordinates(lines: list[str] | tuple[str, ...]) -> tuple[float | None, float | None]:
    """Accept only explicitly labeled, plausible decimal coordinates."""
    text = " ".join(lines).replace("\n", " ")
    text = re.sub(r"(?<=\d)[Oo](?=\d)", "0", text)
    latitude_match = LATITUDE.search(text)
    longitude_match = LONGITUDE.search(text)
    if not latitude_match or not longitude_match:
        return None, None

    def read(match: re.Match[str], negative: str, positive: str) -> float | None:
        value = float(match.group(1).replace(",", "."))
        direction = (match.group(2) or "").upper()
        if direction and direction not in (negative, positive):
            return None
        if direction:
            value = abs(value) * (-1 if direction == negative else 1)
        return value

    latitude = read(latitude_match, "S", "N")
    longitude = read(longitude_match, "W", "E")
    if latitude is None or longitude is None:
        return None, None
    if not (math.isfinite(latitude) and math.isfinite(longitude)):
        return None, None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180) or (latitude == 0 and longitude == 0):
        return None, None
    return latitude, longitude


@lru_cache(maxsize=1)
def ocr_engine():
    from rapidocr import RapidOCR

    return RapidOCR()


def extract_image_location(image: Image.Image) -> tuple[float | None, float | None, str | None]:
    """Use EXIF first, then OCR the printed GPS text when EXIF is absent."""
    latitude, longitude = extract_gps(image)
    if latitude is not None and longitude is not None:
        return latitude, longitude, "exif"
    try:
        rgb = image.convert("RGB")
        # Camera apps usually place the stamp at an edge. This avoids OCR on road texture.
        width, height = rgb.size
        crops = (
            rgb.crop((0, int(height * 0.60), width, height)),
            rgb.crop((0, 0, width, int(height * 0.40))),
        )
        for crop in crops:
            output = ocr_engine()(np.asarray(crop))
            lines = list(output.txts or ())
            latitude, longitude = parse_overlay_coordinates(lines)
            if latitude is not None and longitude is not None:
                return latitude, longitude, "image_overlay"
    except Exception:
        logger.exception("Unable to read coordinate text from image")
    return None, None, None
