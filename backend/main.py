from __future__ import annotations

import base64
import csv
import io
import logging
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image
from ultralytics import YOLO


PROJECT_ROOT = Path(__file__).resolve().parents[1]

METRIC_COLUMNS = (
    "metrics/precision(B)",
    "metrics/recall(B)",
    "metrics/mAP50(B)",
    "metrics/mAP50-95(B)",
)
MODEL_CANDIDATES = (
    {
        "model": PROJECT_ROOT / "models" / "best.pt",
        "metrics": PROJECT_ROOT / "models" / "results.csv",
        "config": PROJECT_ROOT / "models" / "args.yaml",
        "run": "models",
        "name": "YOLO11n RDD2022 India",
        "dataset_name": "RDD2022 India",
        "dataset_root": PROJECT_ROOT / "data" / "RDD2022_INDIA",
    },
    {
        "model": PROJECT_ROOT / "results" / "full_india_training" / "yolo11n_full" / "weights" / "best.pt",
        "metrics": PROJECT_ROOT / "results" / "full_india_training" / "yolo11n_full" / "results.csv",
        "config": PROJECT_ROOT / "results" / "full_india_training" / "yolo11n_full" / "args.yaml",
        "run": "results/full_india_training/yolo11n_full",
        "name": "YOLO11n full India RDD2022 run",
        "dataset_name": "RDD2022 India",
        "dataset_root": PROJECT_ROOT / "data" / "RDD2022_INDIA",
    },
    {
        "model": PROJECT_ROOT / "results" / "compact_training" / "yolo11n_compact" / "weights" / "best.pt",
        "metrics": PROJECT_ROOT / "results" / "compact_training" / "yolo11n_compact" / "results.csv",
        "config": PROJECT_ROOT / "results" / "compact_training" / "yolo11n_compact" / "args.yaml",
        "run": "results/compact_training/yolo11n_compact",
        "name": "YOLO11n compact RDD2022 run",
        "dataset_name": "RDD2022 India compact",
        "dataset_root": PROJECT_ROOT / "data" / "RDD2022_INDIA_COMPACT",
    },
    {
        "model": PROJECT_ROOT / "results" / "training" / "yolo11n_india" / "weights" / "best.pt",
        "metrics": PROJECT_ROOT / "results" / "training" / "yolo11n_india" / "results.csv",
        "config": PROJECT_ROOT / "results" / "training" / "yolo11n_india" / "args.yaml",
        "run": "results/training/yolo11n_india",
        "name": "YOLO11n India RDD2022 run",
        "dataset_name": "RDD2022 India",
        "dataset_root": PROJECT_ROOT / "data" / "RDD2022_INDIA",
    },
    {
        "model": PROJECT_ROOT / "results" / "training" / "yolo11n_india_small" / "weights" / "best.pt",
        "metrics": PROJECT_ROOT / "results" / "training" / "yolo11n_india_small" / "results.csv",
        "config": PROJECT_ROOT / "results" / "training" / "yolo11n_india_small" / "args.yaml",
        "run": "results/training/yolo11n_india_small",
        "name": "YOLO11n small India RDD2022 run",
        "dataset_name": "RDD2022 India small",
        "dataset_root": PROJECT_ROOT / "data" / "RDD2022_INDIA_SMALL",
    },
)
MAPILLARY_CSV = PROJECT_ROOT / "data" / "Mapillary" / "mapillary_images.csv"
DETECTIONS_CSV = (
    PROJECT_ROOT / "results" / "mapillary_yolo" / "mapillary_damage_detections.csv"
)
MAPILLARY_IMAGES = PROJECT_ROOT / "data" / "Mapillary" / "images"
CONFIDENCE_THRESHOLD = float(os.getenv("ROAD_RESILIENCE_CONFIDENCE", "0.25"))
INFERENCE_IMAGE_SIZE = int(os.getenv("ROAD_RESILIENCE_IMAGE_SIZE", "640"))
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
logger = logging.getLogger("road_resilience.inference")

app = FastAPI(
    title="Road Resilience API",
    version="0.1.0",
    description="Verified model inference and project evidence for the Road Resilience prototype.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "ROAD_RESILIENCE_CORS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

model: YOLO | None = None
model_error: str | None = None


def load_model() -> YOLO:
    global model, model_error
    if model is not None:
        return model
    if not MODEL_PATH.exists():
        model_error = f"Model checkpoint not found: {MODEL_PATH}"
        raise RuntimeError(model_error)
    try:
        model = YOLO(str(MODEL_PATH))
        logger.info(
            "YOLO checkpoint loaded: checkpoint=%s task=%s names=%s",
            MODEL_PATH.relative_to(PROJECT_ROOT),
            model.task,
            model.names,
        )
    except Exception as exc:
        model_error = f"Unable to load model checkpoint: {exc}"
        raise RuntimeError(model_error) from exc
    return model


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def numeric(value: str | None) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def valid_metric_rows(path: Path) -> list[dict[str, str]]:
    rows = read_csv(path)
    return [
        row
        for row in rows
        if all(numeric(row.get(column)) is not None for column in METRIC_COLUMNS)
    ]


def select_model_candidate() -> dict[str, Any] | None:
    available: list[dict[str, Any]] = []
    for candidate in MODEL_CANDIDATES:
        if not candidate["model"].exists() or not candidate["metrics"].exists():
            continue
        rows = valid_metric_rows(candidate["metrics"])
        if not rows:
            continue
        final = rows[-1]
        candidate_with_metrics = dict(candidate)
        candidate_with_metrics["final_metrics"] = final
        available.append(candidate_with_metrics)
    if not available:
        return None
    return max(
        available,
        key=lambda candidate: (
            numeric(candidate["final_metrics"].get("metrics/mAP50-95(B)")) or -1.0,
            numeric(candidate["final_metrics"].get("metrics/mAP50(B)")) or -1.0,
        ),
    )


SELECTED_MODEL = select_model_candidate()
MODEL_PATH = (
    SELECTED_MODEL["model"]
    if SELECTED_MODEL
    else PROJECT_ROOT / "models" / "best.pt"
)
METRICS_CSV = SELECTED_MODEL["metrics"] if SELECTED_MODEL else PROJECT_ROOT / "models" / "results.csv"
MODEL_CONFIG = SELECTED_MODEL["config"] if SELECTED_MODEL else PROJECT_ROOT / "models" / "args.yaml"
DATASET_ROOT = (
    SELECTED_MODEL["dataset_root"]
    if SELECTED_MODEL
    else PROJECT_ROOT / "data" / "RDD2022_INDIA"
)


def model_info() -> dict[str, Any]:
    names: dict[int, str] = {}
    status = "unavailable"
    error = model_error
    try:
        loaded = load_model()
        names = {int(key): str(value) for key, value in loaded.names.items()}
        status = "ready"
        error = None
    except RuntimeError:
        pass
    run = SELECTED_MODEL["run"] if SELECTED_MODEL else None
    name = SELECTED_MODEL["name"] if SELECTED_MODEL else "Unavailable model"
    dataset_name = SELECTED_MODEL["dataset_name"] if SELECTED_MODEL else None
    return {
        "name": name,
        "checkpoint": str(MODEL_PATH.relative_to(PROJECT_ROOT)),
        "status": status,
        "task": "detect",
        "confidence_threshold": CONFIDENCE_THRESHOLD,
        "inference_image_size": INFERENCE_IMAGE_SIZE,
        "class_names": names,
        "error": error,
        "evidence": f"{run} validation run." if run else "No validated model run is available.",
        "training_run": run,
        "validation_dataset": dataset_name,
        "dataset": {
            split: len(list((DATASET_ROOT / split / "images").glob("*.jpg")))
            for split in ("train", "val", "test")
        },
    }


def parse_metrics() -> dict[str, Any]:
    rows = valid_metric_rows(METRICS_CSV)
    if not rows:
        return {
            "available": False,
            "checkpoint": str(MODEL_PATH.relative_to(PROJECT_ROOT)),
            "run": SELECTED_MODEL["run"] if SELECTED_MODEL else None,
            "source": str(METRICS_CSV.relative_to(PROJECT_ROOT)),
        }
    final = rows[-1]
    return {
        "available": True,
        "checkpoint": str(MODEL_PATH.relative_to(PROJECT_ROOT)),
        "run": SELECTED_MODEL["run"] if SELECTED_MODEL else None,
        "epochs": len(rows),
        "precision": numeric(final.get("metrics/precision(B)")),
        "recall": numeric(final.get("metrics/recall(B)")),
        "map50": numeric(final.get("metrics/mAP50(B)")),
        "map5095": numeric(final.get("metrics/mAP50-95(B)")),
        "source": str(METRICS_CSV.relative_to(PROJECT_ROOT)),
        "validation_dataset": SELECTED_MODEL["dataset_name"] if SELECTED_MODEL else None,
        "per_class_available": False,
        "limitations": [
            "The saved CSV contains aggregate validation metrics only.",
            "Deployment detections are not an accuracy measurement.",
        ],
    }


def mapillary_observations() -> list[dict[str, Any]]:
    observations = []
    for row in read_csv(DETECTIONS_CSV):
        latitude = numeric(row.get("latitude"))
        longitude = numeric(row.get("longitude"))
        confidence = numeric(row.get("confidence")) or 0.0
        observations.append(
            {
                "image_id": row.get("image_id"),
                "filename": row.get("filename"),
                "damage_class": int(row["damage_class"]) if row.get("damage_class", "").isdigit() else None,
                "damage_type": row.get("damage_type", "Unknown"),
                "confidence": confidence,
                "bbox": [numeric(row.get(key)) for key in ("x1", "y1", "x2", "y2")],
                "latitude": latitude,
                "longitude": longitude,
                "location_status": "geolocated_observation"
                if latitude is not None and longitude is not None
                else "unmatched_observation",
                "road_id": None,
                "source": "Mapillary metadata + saved YOLO inference",
                "image_available": (MAPILLARY_IMAGES / row.get("filename", "")).exists(),
            }
        )
    return observations


def mapillary_records() -> list[dict[str, Any]]:
    detections_by_file: dict[str, list[dict[str, Any]]] = {}
    for observation in mapillary_observations():
        detections_by_file.setdefault(observation["filename"], []).append(
            {
                "damage_type": observation["damage_type"],
                "confidence": observation["confidence"],
                "bbox": observation["bbox"],
            }
        )

    records = []
    for row in read_csv(MAPILLARY_CSV):
        filename = row.get("filename", "")
        records.append(
            {
                "image_id": row.get("image_id"),
                "filename": filename,
                "latitude": numeric(row.get("latitude")),
                "longitude": numeric(row.get("longitude")),
                "captured_at": row.get("captured_at"),
                "compass_angle": numeric(row.get("compass_angle")),
                "mapillary_url": row.get("image_url"),
                "local_image_available": (MAPILLARY_IMAGES / filename).is_file(),
                "detections": detections_by_file.get(filename, []),
                "detection_count": len(detections_by_file.get(filename, [])),
            }
        )
    return records


def assessment_records(observations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records = []
    for index, observation in enumerate(observations, start=1):
        confidence = observation["confidence"]
        score = round(min(100.0, 50.0 + confidence * 50.0), 1)
        priority = "High" if score >= 75 else "Medium" if score >= 60 else "Low"
        records.append(
            {
                "id": f"observation-{index}",
                "image_id": observation["image_id"],
                "damage_type": observation["damage_type"],
                "condition_score": None,
                "priority_score": score,
                "priority": priority,
                "basis": "Prototype estimate: one detected instance weighted by model confidence; no road-segment match.",
                "road_id": None,
                "location_status": observation["location_status"],
                "latitude": observation["latitude"],
                "longitude": observation["longitude"],
            }
        )
    return records


@app.get("/health")
def health() -> dict[str, Any]:
    info = model_info()
    return {"status": "ok", "model": info}


@app.get("/api/model/metrics")
def get_model_metrics() -> dict[str, Any]:
    return {"model": model_info(), "metrics": parse_metrics()}


@app.get("/api/roads")
def get_roads() -> dict[str, Any]:
    observations = mapillary_observations()
    return {
        "records": assessment_records(observations),
        "observations": observations,
        "road_segment_matches": 0,
        "note": "Coordinates are Mapillary observation coordinates; no reliable OSM road-segment match is present.",
    }


@app.get("/api/dashboard")
def get_dashboard() -> dict[str, Any]:
    images = read_csv(MAPILLARY_CSV)
    observations = mapillary_observations()
    geolocated = [item for item in observations if item["location_status"] == "geolocated_observation"]
    assessments = assessment_records(observations)
    distribution = {
        level: sum(1 for item in assessments if item["priority"] == level)
        for level in ("High", "Medium", "Low")
    }
    return {
        "images_processed": len(images),
        "detections": len(observations),
        "geolocated_observations": len(geolocated),
        "unmatched_observations": len(observations) - len(geolocated),
        "road_segments": 0,
        "priority_distribution": distribution,
        "model_metrics": parse_metrics(),
        "model": model_info(),
        "history": [
            {
                "filename": item["filename"],
                "damage_type": item["damage_type"],
                "confidence": item["confidence"],
                "location_status": item["location_status"],
            }
            for item in observations
        ],
        "limitations": [
            "No OSM road-segment identifiers or validated road-condition measurements are available.",
            "Environmental vulnerability is not assessed.",
        ],
    }


@app.get("/api/mapillary")
def get_mapillary() -> dict[str, Any]:
    records = mapillary_records()
    return {
        "source": "data/Mapillary/mapillary_images.csv",
        "records": records,
        "total_images": len(records),
        "images_with_local_files": sum(1 for item in records if item["local_image_available"]),
        "images_with_detections": sum(1 for item in records if item["detection_count"] > 0),
        "total_detections": sum(item["detection_count"] for item in records),
        "note": "This demo uses the repository's downloaded Mapillary metadata and local image cache. It does not call the live Mapillary API because no access token is configured.",
    }


@app.get("/api/samples")
def get_samples() -> dict[str, Any]:
    samples = []
    for row in read_csv(MAPILLARY_CSV):
        filename = row.get("filename", "")
        if filename and (MAPILLARY_IMAGES / filename).exists():
            samples.append(
                {
                    "filename": filename,
                    "image_id": row.get("image_id"),
                    "latitude": numeric(row.get("latitude")),
                    "longitude": numeric(row.get("longitude")),
                    "url": f"/api/samples/{filename}",
                }
            )
    return {"samples": samples}


@app.get("/api/samples/{filename}")
def get_sample(filename: str) -> FileResponse:
    if Path(filename).name != filename:
        raise HTTPException(status_code=400, detail="Invalid sample filename.")
    path = MAPILLARY_IMAGES / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Sample image not found.")
    return FileResponse(path, media_type="image/jpeg")


@app.post("/api/damage/analyze")
async def analyze_damage(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG, or other image file.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image must be smaller than 15 MB.")
    try:
        image = Image.open(io.BytesIO(content)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="The uploaded file is not a readable image.") from exc

    try:
        loaded = load_model()
        result = loaded.predict(
            source=image,
            imgsz=INFERENCE_IMAGE_SIZE,
            conf=CONFIDENCE_THRESHOLD,
            verbose=False,
        )[0]
        annotated = result.plot()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc

    detections = []
    if result.boxes is not None:
        for box in result.boxes:
            coordinates = [round(float(value), 2) for value in box.xyxy[0].tolist()]
            class_id = int(box.cls[0].item())
            detections.append(
                {
                    "class_id": class_id,
                    "class_name": str(loaded.names.get(class_id, f"class{class_id}")),
                    "confidence": round(float(box.conf[0].item()), 4),
                    "bbox": coordinates,
                }
            )
    logger.info(
        "YOLO inference: checkpoint=%s image=%sx%s imgsz=%s confidence=%.3f raw_detections=%s",
        MODEL_PATH.relative_to(PROJECT_ROOT),
        image.width,
        image.height,
        INFERENCE_IMAGE_SIZE,
        CONFIDENCE_THRESHOLD,
        [
            {
                "class_id": item["class_id"],
                "confidence": item["confidence"],
                "bbox": item["bbox"],
            }
            for item in detections
        ],
    )
    image_buffer = io.BytesIO()
    Image.fromarray(annotated[:, :, ::-1]).save(image_buffer, format="JPEG", quality=90)
    annotated_data = base64.b64encode(image_buffer.getvalue()).decode("ascii")
    return {
        "filename": file.filename,
        "model": model_info(),
        "image_width": image.width,
        "image_height": image.height,
        "detections": detections,
        "annotated_image": f"data:image/jpeg;base64,{annotated_data}",
        "message": "No damage detected by the model."
        if not detections
        else f"{len(detections)} damage instance(s) detected.",
    }
