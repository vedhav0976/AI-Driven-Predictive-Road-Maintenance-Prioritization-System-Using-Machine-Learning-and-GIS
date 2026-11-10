"""Filter a local YOLO-format RDD dataset with full OpenCV pixel decoding.

Usage: python -m backend.preprocess_rdd SOURCE_ROOT OUTPUT_ROOT
Both flat images/labels and train|val|test/images|labels layouts are supported.
The source is never modified. This does not reproduce the report's Kaggle counts.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
from pathlib import Path

import cv2
import numpy as np


def valid_labels(path: Path, class_count: int = 5) -> bool:
    if not path.is_file():
        return False
    try:
        lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        if not lines:
            return False
        for line in lines:
            parts = line.split()
            if len(parts) != 5 or not parts[0].isdigit() or not 0 <= int(parts[0]) < class_count:
                return False
            x, y, width, height = (float(value) for value in parts[1:])
            if not all(math.isfinite(value) for value in (x, y, width, height)):
                return False
            if width <= 0 or height <= 0 or not (0 <= x <= 1 and 0 <= y <= 1):
                return False
            if x - width / 2 < 0 or x + width / 2 > 1 or y - height / 2 < 0 or y + height / 2 > 1:
                return False
        return True
    except (UnicodeError, OSError, ValueError):
        return False


def decoded_pixels(path: Path) -> bool:
    try:
        pixels = cv2.imdecode(np.frombuffer(path.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
        return pixels is not None and pixels.size > 0 and pixels.shape[0] > 0 and pixels.shape[1] > 0
    except (OSError, ValueError, cv2.error):
        return False


def filter_dataset(source: Path, output: Path, class_count: int = 5) -> dict[str, int]:
    source, output = source.resolve(), output.resolve()
    if not source.is_dir():
        raise ValueError(f"Dataset source is not a directory: {source}")
    if output == source or source in output.parents or output in source.parents:
        raise ValueError("Source and output must be separate directories")
    stats = {"raw_images": 0, "corrupt_images": 0, "background_images": 0,
             "invalid_labels": 0, "retained_images": 0}
    image_dirs = [source / split / "images" for split in ("train", "val", "test")]
    if not any(directory.is_dir() for directory in image_dirs):
        image_dirs = [source / "images"]
    for image_dir in image_dirs:
        if not image_dir.is_dir():
            continue
        label_dir = image_dir.parent / "labels"
        for image_path in image_dir.rglob("*"):
            if not image_path.is_file() or image_path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                continue
            stats["raw_images"] += 1
            if not decoded_pixels(image_path):
                stats["corrupt_images"] += 1
                continue
            relative = image_path.relative_to(image_dir)
            label_path = (label_dir / relative).with_suffix(".txt")
            if not label_path.is_file():
                stats["background_images"] += 1
                continue
            try:
                label_text = label_path.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                stats["invalid_labels"] += 1
                continue
            if not label_text.strip():
                stats["background_images"] += 1
                continue
            if not valid_labels(label_path, class_count):
                stats["invalid_labels"] += 1
                continue
            target_image = output / image_path.relative_to(source)
            target_label = output / label_path.relative_to(source)
            target_image.parent.mkdir(parents=True, exist_ok=True)
            target_label.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(image_path, target_image)
            shutil.copy2(label_path, target_label)
            stats["retained_images"] += 1
    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--classes", type=int, default=5, help="Number of class IDs (default: 5 for the supplied checkpoint)")
    arguments = parser.parse_args()
    print(json.dumps(filter_dataset(arguments.source, arguments.output, arguments.classes), indent=2))
