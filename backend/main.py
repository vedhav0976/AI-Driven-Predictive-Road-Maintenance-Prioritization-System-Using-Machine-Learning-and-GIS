from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import logging
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from time import perf_counter
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from sqlalchemy import delete, func, select, true
from ultralytics import YOLO

from backend.assessment import road_geometry, score_detections, snap_to_road
from backend.annotations import render_annotations, suppress_duplicate_boxes
from backend.geotag import extract_image_location
from backend.database import (
    DamageDetection, DetectionRecord, ImageAsset, Observation, RoadSegment, get_session,
    delete_analysis, initialize_database, persist_observation, refresh_road_segment, relocate_observation,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

METRIC_COLUMNS = (
    "metrics/precision(B)",
    "metrics/recall(B)",
    "metrics/mAP50(B)",
    "metrics/mAP50-95(B)",
)
REPORTED_VALIDATION = PROJECT_ROOT / "models" / "reported_validation.json"
MODEL_CANDIDATES = (
    {
        "model": PROJECT_ROOT / "models" / "best.pt",
        "metrics": PROJECT_ROOT / "models" / "results.csv",
        "config": PROJECT_ROOT / "models" / "args.yaml",
        "run": "models",
        "name": "Supplied road-damage YOLO checkpoint",
        "dataset_name": "RDD2022",
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
INFERENCE_IMAGE_SIZE = int(os.getenv("ROAD_RESILIENCE_IMAGE_SIZE", "960"))
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
STORAGE_ROOT = Path(__file__).resolve().parent / "storage"
UPLOAD_DIR = STORAGE_ROOT / "uploads"
ANNOTATED_DIR = STORAGE_ROOT / "annotated"
logger = logging.getLogger("road_resilience.inference")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_database()
    migrate_saved_images()
    repair_duplicate_annotations()
    backfill_saved_inferences()
    yield


app = FastAPI(
    title="Road Resilience API",
    version="0.1.0",
    description="Verified model inference and project evidence for the Road Resilience prototype.",
    lifespan=lifespan,
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


def migrate_saved_images() -> None:
    """Copy legacy disk images into the database without deleting the originals."""
    with get_session() as session:
        for record in session.scalars(select(DetectionRecord)).all():
            if session.get(ImageAsset, record.id) is not None:
                continue
            original = Path(record.image_path)
            annotated = Path(record.annotated_image_path)
            if not original.is_file() or not annotated.is_file():
                logger.warning("Image files unavailable for legacy record %s", record.id)
                continue
            suffix = original.suffix.lower()
            content_type = "image/png" if suffix == ".png" else "image/jpeg" if suffix in (".jpg", ".jpeg") else "application/octet-stream"
            session.add(ImageAsset(
                record_id=record.id, original_bytes=original.read_bytes(),
                original_content_type=content_type, annotated_bytes=annotated.read_bytes(),
            ))
        session.commit()


def repair_duplicate_annotations() -> None:
    """Update saved analyses that labeled one region more than once."""
    with get_session() as session:
        for record in session.scalars(select(DetectionRecord)).all():
            filtered = suppress_duplicate_boxes(record.detections)
            removed = len(record.detections) - len(filtered)
            if removed == 0:
                continue
            asset = session.get(ImageAsset, record.id)
            if asset is None:
                logger.warning("Cannot redraw duplicate detections for record %s without its original image", record.id)
                continue
            with Image.open(io.BytesIO(asset.original_bytes)) as source:
                width, height = source.size
                annotated = render_annotations(source, filtered)
            buffer = io.BytesIO()
            annotated.save(buffer, format="JPEG", quality=90)
            asset.annotated_bytes = buffer.getvalue()
            record.detections = filtered
            record.detection_count = len(filtered)
            score = score_detections(filtered, width, height, record.road_type)
            for key, value in score.items():
                setattr(record, key, value)
            observation = session.scalar(select(Observation).where(Observation.legacy_record_id == record.id))
            if observation is not None:
                observation.pci_score = record.pci_proxy
                observation.mpi_score = record.mpi_proxy
                observation.priority_tier = record.priority
                session.execute(delete(DamageDetection).where(DamageDetection.observation_id == observation.id))
                for item in filtered:
                    x1, y1, x2, y2 = item["bbox"]
                    session.add(DamageDetection(
                        observation_id=observation.id, class_id=item["class_id"],
                        class_name=item["class_name"], confidence=item["confidence"],
                        bbox_x_center=(x1 + x2) / 2, bbox_y_center=(y1 + y2) / 2,
                        bbox_width=max(0.0, x2 - x1), bbox_height=max(0.0, y2 - y1),
                    ))
                session.flush()
                refresh_road_segment(session, observation.segment_id)
            logger.info("Removed %s overlapping duplicate(s) from saved record %s",
                        removed, record.id)
        session.commit()


def backfill_saved_inferences() -> None:
    """Populate normalized rows and current scores without inventing lost GPS."""
    with get_session() as session:
        existing = set(session.scalars(select(Observation.legacy_record_id)).all())
        records = session.scalars(select(DetectionRecord)).all()
        for record in records:
            if record.id in existing:
                continue
            record.location_status = record.location_status or "no_gps"
            asset = session.get(ImageAsset, record.id)
            if asset is not None or Path(record.image_path).is_file():
                try:
                    with Image.open(io.BytesIO(asset.original_bytes) if asset else record.image_path) as image:
                        assessment = score_detections(record.detections, *image.size, record.road_type)
                    for key, value in assessment.items():
                        setattr(record, key, value)
                except (OSError, KeyError, TypeError, ValueError):
                    logger.warning("Unable to backfill assessment for detection record %s", record.id)
            persist_observation(session, record, json.dumps(road_geometry(record.road_id)) if record.road_id and road_geometry(record.road_id) else None)
        session.commit()


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
    metrics = parse_metrics()
    run = SELECTED_MODEL["run"] if SELECTED_MODEL else metrics.get("run") if metrics.get("reported") else None
    name = SELECTED_MODEL["name"] if SELECTED_MODEL else (
        "Supplied road-damage YOLO checkpoint" if MODEL_PATH.exists() else "Unavailable model"
    )
    dataset_name = SELECTED_MODEL["dataset_name"] if SELECTED_MODEL else metrics.get("validation_dataset") if metrics.get("reported") else None
    return {
        "name": name,
        "checkpoint": str(MODEL_PATH.relative_to(PROJECT_ROOT)),
        "status": status,
        "task": "detect",
        "confidence_threshold": CONFIDENCE_THRESHOLD,
        "inference_image_size": INFERENCE_IMAGE_SIZE,
        "class_names": names,
        "error": error,
        "evidence": "User-reported validation output linked to this checkpoint hash; original run files are absent."
        if metrics.get("reported") else f"{run} validation run." if run else "No validated model run is available.",
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
        if MODEL_PATH.is_file() and REPORTED_VALIDATION.is_file():
            try:
                report = json.loads(REPORTED_VALIDATION.read_text(encoding="utf-8"))
                with MODEL_PATH.open("rb") as handle:
                    checkpoint_hash = hashlib.file_digest(handle, "sha256").hexdigest().upper()
                if checkpoint_hash == report["checkpoint_sha256"]:
                    return {
                        **report,
                        "available": True,
                        "reported": True,
                        "checkpoint": str(MODEL_PATH.relative_to(PROJECT_ROOT)),
                        "run": "User-provided validation console output",
                        "source": str(REPORTED_VALIDATION.relative_to(PROJECT_ROOT)),
                        "per_class_available": True,
                        "limitations": [
                            "Values were transcribed from the user's training output; the validation dataset and original run files are not available locally.",
                            "Inference speed was measured in the reported training environment and is not local API latency.",
                            "These validation metrics do not measure accuracy on uploaded road images.",
                        ],
                    }
            except (OSError, ValueError, KeyError, TypeError) as exc:
                logger.warning("Unable to use reported validation metrics: %s", exc)
        return {
            "available": False,
            "checkpoint": str(MODEL_PATH.relative_to(PROJECT_ROOT)),
            "run": SELECTED_MODEL["run"] if SELECTED_MODEL else None,
            "source": str(METRICS_CSV.relative_to(PROJECT_ROOT)),
        }
    final = rows[-1]
    return {
        "available": True,
        "reported": False,
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


def saved_inferences() -> list[DetectionRecord]:
    with get_session() as session:
        return list(
            session.scalars(
                select(DetectionRecord).order_by(DetectionRecord.created_at.desc(), DetectionRecord.id.desc())
            ).all()
        )


def upload_observations(uploads: list[DetectionRecord]) -> list[dict[str, Any]]:
    return [
        {
            "image_id": f"upload-{record.id}",
            "filename": record.original_filename,
            "damage_type": detection["class_name"],
            "confidence": detection["confidence"],
            "latitude": record.latitude,
            "longitude": record.longitude,
            "road_id": record.road_id,
            "road_name": record.road_name,
            "snap_distance_m": record.snap_distance_m,
            "snapped_latitude": record.snapped_latitude,
            "snapped_longitude": record.snapped_longitude,
            "location_status": record.location_status or "no_gps",
            "location_source": record.location_source,
            "source": "uploaded_inference",
            "bbox": detection["bbox"],
            "pci_proxy": record.pci_proxy,
            "mpi_proxy": record.mpi_proxy,
            "priority": record.priority,
            "scoring_basis": record.scoring_basis,
        }
        for record in uploads
        for detection in record.detections
    ]


def upload_assessment(record: DetectionRecord) -> dict[str, Any]:
    return {
        "id": f"upload-{record.id}", "image_id": f"upload-{record.id}",
        "damage_type": ", ".join(sorted({item["class_name"] for item in record.detections})),
        "condition_score": record.pci_proxy, "pci_proxy": record.pci_proxy,
        "priority_score": record.mpi_proxy, "mpi_proxy": record.mpi_proxy,
        "priority": record.priority, "basis": record.scoring_basis,
        "road_id": record.road_id, "road_name": record.road_name,
        "snap_distance_m": record.snap_distance_m,
        "snapped_latitude": record.snapped_latitude,
        "snapped_longitude": record.snapped_longitude,
        "location_status": record.location_status or "no_gps",
        "latitude": record.latitude, "longitude": record.longitude,
    }


@app.get("/health")
def health() -> dict[str, Any]:
    info = model_info()
    return {"status": "ok", "model": info}


@app.get("/api/model/metrics")
def get_model_metrics() -> dict[str, Any]:
    return {"model": model_info(), "metrics": parse_metrics()}


@app.get("/api/roads")
def get_roads() -> dict[str, Any]:
    uploads = saved_inferences()
    observations = upload_observations(uploads) + mapillary_observations()
    upload_assessments = [upload_assessment(record) for record in uploads if record.detections]
    return {
        "records": upload_assessments + assessment_records(mapillary_observations()),
        "observations": observations,
        "road_segment_matches": len({record.road_id for record in uploads if record.road_id and record.detections}),
        "note": "Uploaded images with EXIF GPS are matched to the nearest configured GeoJSON line within 30 m. The default file has local feature IDs; an imported OSMnx file can provide graph-edge IDs. Mapillary CSV observations remain unmatched.",
    }


@app.get("/api/dashboard")
def get_dashboard() -> dict[str, Any]:
    images = read_csv(MAPILLARY_CSV)
    observations = mapillary_observations()
    uploads = saved_inferences()
    uploaded_observations = upload_observations(uploads)
    with get_session() as session:
        scored_segments = session.scalars(select(RoadSegment)).all()
    geolocated = [item for item in observations if item["location_status"] == "geolocated_observation"]
    geolocated += [item for item in uploaded_observations if item["latitude"] is not None]
    distribution = {
        level: sum(1 for item in scored_segments if item.priority_tier == level)
        for level in ("High", "Medium", "Low")
    }
    return {
        "images_processed": len(images) + len(uploads),
        "uploaded_images": len(uploads),
        "detections": len(observations) + len(uploaded_observations),
        "geolocated_observations": len(geolocated),
        "unmatched_observations": len(observations) + len(uploaded_observations)
        - sum(1 for item in uploaded_observations if item["road_id"]),
        "road_segments": sum(1 for item in scored_segments if item.pci_score is not None),
        "priority_distribution": distribution,
        "model_metrics": parse_metrics(),
        "model": model_info(),
        "recent_uploads": [
            {
                "id": record.id,
                "filename": record.original_filename,
                "detection_count": record.detection_count,
                "inference_ms": record.inference_ms,
                "created_at": record.created_at,
                "latitude": record.latitude,
                "longitude": record.longitude,
                "road_id": record.road_id,
                "location_source": record.location_source,
                "pci_proxy": record.pci_proxy,
                "mpi_proxy": record.mpi_proxy,
                "priority": record.priority,
            }
            for record in uploads[:20]
        ],
        "history": [
            {
                "filename": item["filename"],
                "damage_type": item["damage_type"],
                "confidence": item["confidence"],
                "location_status": item["location_status"],
                "location_source": item["location_source"],
                "source": "uploaded_inference",
                "road_id": item["road_id"],
                "pci_proxy": item["pci_proxy"],
                "mpi_proxy": item["mpi_proxy"],
                "priority": item["priority"],
            }
            for item in uploaded_observations
        ] + [
            {
                "filename": item["filename"],
                "damage_type": item["damage_type"],
                "confidence": item["confidence"],
                "location_status": item["location_status"],
                "source": "mapillary_saved_detection",
            }
            for item in observations
        ],
        "limitations": [
            "GPS road snapping is approximate and not field-validated. The default road file has local feature IDs.",
            "Environmental vulnerability is not assessed.",
            "PCI/MPI values are visual proxies, not ASTM PCI or a validated maintenance priority index. Images without EXIF or manually supplied coordinates remain unmatched.",
        ],
    }


@app.get("/api/dashboard/stats")
def get_dashboard_stats() -> dict[str, Any]:
    with get_session() as session:
        observations = session.scalars(select(Observation)).all()
        detections = session.scalars(select(DamageDetection)).all()
        segments = session.scalars(select(RoadSegment)).all()
        return {
            "images_processed": len(observations),
            "detections": len(detections),
            "geolocated": sum(1 for item in observations if item.geolocated),
            "matched_observations": sum(1 for item in observations if item.segment_id),
            "road_segments": sum(1 for item in segments if item.pci_score is not None),
            "priority_distribution": {
                tier: sum(1 for item in segments if item.priority_tier == tier)
                for tier in ("High", "Medium", "Low")
            },
            "basis": "Saved uploaded images only; segment PCI/MPI use the specified class-count formula and OSM road-class factor as unvalidated proxies.",
        }


@app.get("/api/observations")
def get_observations(priority: str | None = None, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    if priority is not None and priority not in {"High", "Medium", "Low"}:
        raise HTTPException(status_code=422, detail="Priority must be High, Medium, or Low.")
    limit, offset = max(1, min(limit, 200)), max(0, offset)
    with get_session() as session:
        query = select(Observation).order_by(Observation.created_at.desc(), Observation.id.desc())
        if priority:
            query = query.where(Observation.priority_tier == priority)
        observations = session.scalars(query.offset(offset).limit(limit)).all()
        records = []
        for item in observations:
            detections = session.scalars(
                select(DamageDetection).where(DamageDetection.observation_id == item.id)
            ).all()
            records.append({
                "id": item.id, "filename": item.original_filename,
                "latitude": item.latitude, "longitude": item.longitude,
                "geolocated": item.geolocated, "processed": item.processed,
                "location_status": item.location_status,
                "location_source": item.location_source,
                "road_id": item.segment_id,
                "pci_score": item.pci_score, "mpi_score": item.mpi_score,
                "priority": item.priority_tier,
                "detection_count": len(detections),
                "damage_types": sorted({detection.class_name for detection in detections}),
                "max_confidence": max((detection.confidence for detection in detections), default=None),
                "annotated_image_url": f"/api/detections/{item.legacy_record_id}/image" if item.legacy_record_id else None,
                "created_at": item.created_at,
            })
        return {"records": records, "limit": limit, "offset": offset}


@app.post("/api/observations/{observation_id}/recheck-location")
def recheck_observation_location(observation_id: int) -> dict[str, Any]:
    with get_session() as session:
        observation = session.get(Observation, observation_id)
        if observation is None or observation.legacy_record_id is None:
            raise HTTPException(status_code=404, detail="Saved upload not found.")
        record = session.get(DetectionRecord, observation.legacy_record_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Saved upload not found.")
        asset = session.get(ImageAsset, record.id)
        if asset is None:
            raise HTTPException(status_code=404, detail="Original image is unavailable.")
        with Image.open(io.BytesIO(asset.original_bytes)) as source_image:
            latitude, longitude, source = extract_image_location(source_image)
            width, height = source_image.size
        if latitude is None or longitude is None or source is None:
            raise HTTPException(status_code=422, detail="No readable GPS metadata or coordinate stamp was found in this image.")
        road_match = snap_to_road(latitude, longitude)
        assessment = score_detections(record.detections, width, height, road_match["road_type"])
        geometry = road_geometry(road_match["road_id"]) if road_match["road_id"] else None
        relocate_observation(
            session, observation, record, latitude, longitude,
            road_match, assessment, json.dumps(geometry) if geometry else None, source,
        )
        session.commit()
        return {
            "id": observation.id, "latitude": observation.latitude,
            "longitude": observation.longitude, "location_source": observation.location_source,
            "location_status": observation.location_status, "road_id": observation.segment_id,
            "pci_score": observation.pci_score, "mpi_score": observation.mpi_score,
            "priority": observation.priority_tier,
        }


@app.get("/api/map")
def get_priority_map() -> dict[str, Any]:
    with get_session() as session:
        segments = session.scalars(select(RoadSegment).order_by(RoadSegment.segment_id)).all()
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature", "id": segment.segment_id,
                    "geometry": json.loads(segment.geometry_geojson),
                    "properties": {
                        "segment_id": segment.segment_id, "road_name": segment.road_name,
                        "road_type": segment.road_type,
                        "criticality_factor": segment.criticality_factor,
                        "pci_score": segment.pci_score, "mpi_score": segment.mpi_score,
                        "priority": segment.priority_tier,
                        "color": {"High": "#EF4444", "Medium": "#F59E0B", "Low": "#10B981"}.get(segment.priority_tier, "#94a3b8"),
                    },
                }
                for segment in segments
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


@app.get("/api/detections")
def get_detections(limit: int = 50, offset: int = 0, query: str = "") -> dict[str, Any]:
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    query = query.strip()[:100]
    with get_session() as session:
        condition = DetectionRecord.original_filename.ilike(f"%{query}%") if query else true()
        total = session.scalar(select(func.count(DetectionRecord.id)).where(condition)) or 0
        records = session.scalars(
            select(DetectionRecord).where(condition)
            .order_by(DetectionRecord.created_at.desc(), DetectionRecord.id.desc())
            .offset(offset)
            .limit(limit)
        ).all()
        return {
            "total": total, "limit": limit, "offset": offset,
            "records": [
                {
                    "id": item.id,
                    "filename": item.original_filename,
                    "detection_count": item.detection_count,
                    "inference_ms": item.inference_ms,
                    "created_at": item.created_at,
                    "annotated_image_url": f"/api/detections/{item.id}/image",
                    "latitude": item.latitude, "longitude": item.longitude,
                    "road_id": item.road_id, "road_name": item.road_name,
                    "location_status": item.location_status or "no_gps",
                    "location_source": item.location_source,
                    "pci_proxy": item.pci_proxy, "mpi_proxy": item.mpi_proxy,
                    "priority": item.priority,
                }
                for item in records
            ]
        }


@app.get("/api/detections/{record_id}")
def get_detection(record_id: int) -> dict[str, Any]:
    with get_session() as session:
        record = session.get(DetectionRecord, record_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Detection record not found.")
        return {
            "id": record.id,
            "filename": record.original_filename,
            "detections": record.detections,
            "inference_ms": record.inference_ms,
            "created_at": record.created_at,
            "annotated_image_url": f"/api/detections/{record.id}/image",
            "latitude": record.latitude, "longitude": record.longitude,
            "road_id": record.road_id, "road_name": record.road_name,
            "snap_distance_m": record.snap_distance_m,
            "snapped_latitude": record.snapped_latitude,
            "snapped_longitude": record.snapped_longitude,
            "location_status": record.location_status or "no_gps",
            "location_source": record.location_source,
            "pci_proxy": record.pci_proxy, "mpi_proxy": record.mpi_proxy,
            "priority": record.priority, "scoring_basis": record.scoring_basis,
        }


@app.delete("/api/detections/{record_id}")
def delete_detection(record_id: int, x_delete_key: str | None = Header(default=None)) -> dict[str, Any]:
    configured_key = os.getenv("ROAD_RESILIENCE_DELETE_KEY")
    if not configured_key:
        raise HTTPException(status_code=503, detail="Analysis deletion is not configured.")
    if not x_delete_key or not secrets.compare_digest(x_delete_key, configured_key):
        raise HTTPException(status_code=403, detail="Invalid deletion key.")
    with get_session() as session:
        filename = delete_analysis(session, record_id)
        if filename is None:
            raise HTTPException(status_code=404, detail="Detection record not found.")
        session.commit()
    return {"deleted_id": record_id, "filename": filename}


@app.get("/api/detections/{record_id}/image")
def get_detection_image(record_id: int) -> Response:
    with get_session() as session:
        record = session.get(DetectionRecord, record_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Detection record not found.")
        asset = session.get(ImageAsset, record_id)
        if asset is not None:
            return Response(content=asset.annotated_bytes, media_type="image/jpeg")
        image = ANNOTATED_DIR / Path(record.annotated_image_path).name
        if not image.is_file():
            raise HTTPException(status_code=404, detail="Annotated image not found.")
        return FileResponse(image, media_type="image/jpeg")


@app.get("/api/detections/{record_id}/original")
def get_original_image(record_id: int) -> Response:
    with get_session() as session:
        record = session.get(DetectionRecord, record_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Detection record not found.")
        asset = session.get(ImageAsset, record_id)
        if asset is not None:
            return Response(content=asset.original_bytes, media_type=asset.original_content_type)
        image = UPLOAD_DIR / Path(record.image_path).name
        if not image.is_file():
            raise HTTPException(status_code=404, detail="Original image not found.")
        return FileResponse(image)


@app.post("/api/upload")
@app.post("/api/damage/analyze")
async def analyze_damage(
    file: UploadFile = File(...), include_annotated_image: bool = True,
) -> dict[str, Any]:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG, or other image file.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image must be smaller than 15 MB.")
    try:
        source_image = Image.open(io.BytesIO(content))
        source_format = source_image.format
        latitude, longitude, location_source = extract_image_location(source_image)
        image = source_image.convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="The uploaded file is not a readable image.") from exc
    try:
        loaded = load_model()
        started = perf_counter()
        result = loaded.predict(
            source=image,
            imgsz=INFERENCE_IMAGE_SIZE,
            conf=CONFIDENCE_THRESHOLD,
            verbose=False,
        )[0]
        inference_ms = round((perf_counter() - started) * 1000, 2)
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
    detections = suppress_duplicate_boxes(detections)
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
    road_match = snap_to_road(latitude, longitude)
    assessment = score_detections(detections, image.width, image.height, road_match["road_type"])
    image_buffer = io.BytesIO()
    render_annotations(image, detections).save(image_buffer, format="JPEG", quality=90)
    annotated_bytes = image_buffer.getvalue()
    annotated_data = (
        base64.b64encode(annotated_bytes).decode("ascii")
        if include_annotated_image else None
    )
    unique_name = uuid4().hex
    original_extension = ".png" if source_format == "PNG" else ".jpg" if source_format == "JPEG" else ".img"
    original_content_type = "image/png" if source_format == "PNG" else "image/jpeg" if source_format == "JPEG" else file.content_type
    original_path = UPLOAD_DIR / f"{unique_name}{original_extension}"
    annotated_path = ANNOTATED_DIR / f"{unique_name}_annotated.jpg"
    try:
        with get_session() as session:
            record = DetectionRecord(
                original_filename=(file.filename or "upload")[:255],
                image_path=str(original_path),
                annotated_image_path=str(annotated_path),
                detection_count=len(detections),
                detections=detections,
                inference_ms=inference_ms,
                latitude=latitude,
                longitude=longitude,
                location_source=location_source,
                **road_match,
                **assessment,
            )
            session.add(record)
            session.flush()
            session.add(ImageAsset(
                record_id=record.id, original_bytes=content,
                original_content_type=original_content_type,
                annotated_bytes=annotated_bytes,
            ))
            geometry = road_geometry(record.road_id) if record.road_id else None
            persist_observation(session, record, json.dumps(geometry) if geometry else None)
            session.commit()
            record_id = record.id
    except Exception as exc:
        logger.exception("Unable to save inference history")
        raise HTTPException(status_code=500, detail="Inference succeeded but the result could not be saved.") from exc
    return {
        "id": record_id,
        "filename": file.filename,
        "model": model_info(),
        "image_width": image.width,
        "image_height": image.height,
        "detections": detections,
        "latitude": latitude,
        "longitude": longitude,
        "location_source": location_source,
        **road_match,
        **assessment,
        "annotated_image": f"data:image/jpeg;base64,{annotated_data}" if annotated_data else None,
        "annotated_image_url": f"/api/detections/{record_id}/image",
        "inference_ms": inference_ms,
        "message": "No damage detected by the model."
        if not detections
        else f"{len(detections)} damage instance(s) detected.",
    }


if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="frontend-assets")


@app.get("/{frontend_path:path}", include_in_schema=False)
def serve_frontend(frontend_path: str) -> FileResponse:
    """Serve the built dashboard and its client-side routes on the API origin."""
    if frontend_path.startswith(("api/", "api", "health")) or not FRONTEND_DIST.is_dir():
        raise HTTPException(status_code=404, detail="Not found.")
    requested = (FRONTEND_DIST / frontend_path).resolve()
    if requested.is_relative_to(FRONTEND_DIST.resolve()) and requested.is_file():
        return FileResponse(requested)
    return FileResponse(FRONTEND_DIST / "index.html")
