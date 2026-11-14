"""Persistent inference history for the Road Resilience API."""

from __future__ import annotations

import os
import json
import math
from datetime import datetime
from pathlib import Path

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, LargeBinary, String, Text, create_engine, delete, func, inspect, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


STORAGE_ROOT = Path(__file__).resolve().parent / "storage"
DATABASE_URL = (
    os.getenv("DATABASE_URL")
    or os.getenv("POSTGRES_URL_NON_POOLING")
    or os.getenv("POSTGRES_URL")
    or f"sqlite:///{(STORAGE_ROOT / 'road_resilience.sqlite3').as_posix()}"
)
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgres://"):]
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgresql://"):]


class Base(DeclarativeBase):
    pass


class DetectionRecord(Base):
    __tablename__ = "detection_records"
    __table_args__ = (Index("uq_detection_source_image", "source_type", "source_image_id", unique=True),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    image_path: Mapped[str] = mapped_column(String(500), nullable=False)
    annotated_image_path: Mapped[str] = mapped_column(String(500), nullable=False)
    detection_count: Mapped[int] = mapped_column(Integer, nullable=False)
    detections: Mapped[list] = mapped_column(JSON, nullable=False)
    inference_ms: Mapped[float] = mapped_column(Float, nullable=False)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    road_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    road_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    road_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    criticality_factor: Mapped[float | None] = mapped_column(Float, nullable=True)
    snap_distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    snapped_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    snapped_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    location_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    location_source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    source_image_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    pci_proxy: Mapped[float | None] = mapped_column(Float, nullable=True)
    mpi_proxy: Mapped[float | None] = mapped_column(Float, nullable=True)
    priority: Mapped[str | None] = mapped_column(String(10), nullable=True)
    scoring_basis: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ImageAsset(Base):
    """Original upload and annotated result, kept outside list-query rows."""

    __tablename__ = "image_assets"

    record_id: Mapped[int] = mapped_column(ForeignKey("detection_records.id"), primary_key=True)
    original_bytes: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    original_content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    annotated_bytes: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)


class RoadSegment(Base):
    __tablename__ = "road_segments"

    segment_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    road_name: Mapped[str | None] = mapped_column(String(255))
    road_type: Mapped[str | None] = mapped_column(String(80))
    criticality_factor: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    pci_score: Mapped[float | None] = mapped_column(Float)
    mpi_score: Mapped[float | None] = mapped_column(Float)
    priority_tier: Mapped[str | None] = mapped_column(String(10))
    geometry_geojson: Mapped[str] = mapped_column(Text, nullable=False)
    near_critical_facility: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=None)
    critical_facility_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    projected_pci_60d: Mapped[float | None] = mapped_column(Float, nullable=True)
    days_to_critical: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Observation(Base):
    __tablename__ = "observations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    geolocated: Mapped[bool] = mapped_column(Boolean, nullable=False)
    processed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    raw_path: Mapped[str] = mapped_column(String(500), nullable=False)
    annotated_path: Mapped[str] = mapped_column(String(500), nullable=False)
    segment_id: Mapped[str | None] = mapped_column(ForeignKey("road_segments.segment_id"))
    legacy_record_id: Mapped[int | None] = mapped_column(ForeignKey("detection_records.id"), unique=True)
    location_status: Mapped[str] = mapped_column(String(40), nullable=False)
    location_source: Mapped[str | None] = mapped_column(String(40))
    inference_ms: Mapped[float] = mapped_column(Float, nullable=False)
    pci_score: Mapped[float | None] = mapped_column(Float)
    mpi_score: Mapped[float | None] = mapped_column(Float)
    priority_tier: Mapped[str | None] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class DamageDetection(Base):
    __tablename__ = "detections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    observation_id: Mapped[int] = mapped_column(ForeignKey("observations.id"), nullable=False)
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    class_name: Mapped[str] = mapped_column(String(100), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_x_center: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_y_center: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_width: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_height: Mapped[float] = mapped_column(Float, nullable=False)


engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    **({"pool_size": 1, "max_overflow": 0} if not DATABASE_URL.startswith("sqlite:") else {}),
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite:") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def initialize_database() -> None:
    if DATABASE_URL.startswith("sqlite:"):
        STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    # Preserve records from the earlier schema while adding nullable assessment fields.
    legacy_existing = {column["name"] for column in inspect(engine).get_columns("detection_records")}
    legacy_columns = {
        "latitude": "FLOAT", "longitude": "FLOAT", "road_id": "VARCHAR(255)",
        "road_name": "VARCHAR(255)", "road_type": "VARCHAR(80)",
        "criticality_factor": "FLOAT", "snap_distance_m": "FLOAT",
        "snapped_latitude": "FLOAT", "snapped_longitude": "FLOAT",
        "location_status": "VARCHAR(40)", "pci_proxy": "FLOAT",
        "location_source": "VARCHAR(40)",
        "source_type": "VARCHAR(40)", "source_image_id": "VARCHAR(100)", "source_metadata": "JSON",
        "mpi_proxy": "FLOAT", "priority": "VARCHAR(10)",
        "scoring_basis": "VARCHAR(255)",
    }
    observation_existing = {column["name"] for column in inspect(engine).get_columns("observations")}
    with engine.begin() as connection:
        postgres = DATABASE_URL.startswith("postgresql")
        if postgres:
            # Serialize additive upgrades across concurrent serverless cold starts.
            connection.execute(text("SELECT pg_advisory_xact_lock(631684295)"))
        exists_guard = " IF NOT EXISTS" if postgres else ""
        for name, column_type in legacy_columns.items():
            if name not in legacy_existing:
                connection.execute(text(f"ALTER TABLE detection_records ADD COLUMN{exists_guard} {name} {column_type}"))
        if "location_source" not in observation_existing:
            connection.execute(text(f"ALTER TABLE observations ADD COLUMN{exists_guard} location_source VARCHAR(40)"))
        road_existing = {column["name"] for column in inspect(connection).get_columns("road_segments")}
        road_columns = {"near_critical_facility": "BOOLEAN", "critical_facility_name": "VARCHAR(255)",
                        "projected_pci_60d": "FLOAT", "days_to_critical": "INTEGER"}
        for name, column_type in road_columns.items():
            if name not in road_existing:
                connection.execute(text(f"ALTER TABLE road_segments ADD COLUMN{exists_guard} {name} {column_type}"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_detection_source_image ON detection_records (source_type, source_image_id)"))


def get_session() -> Session:
    return SessionLocal()


def ensure_road_segment(session: Session, record: DetectionRecord, geometry_geojson: str | None) -> None:
    if not record.road_id or not geometry_geojson or session.get(RoadSegment, record.road_id):
        return
    session.add(RoadSegment(
        segment_id=record.road_id, road_name=record.road_name,
        road_type=record.road_type, criticality_factor=record.criticality_factor or 1.0,
        geometry_geojson=geometry_geojson,
    ))
    session.flush()


def refresh_road_segment(session: Session, segment_id: str | None) -> None:
    if not segment_id:
        return
    from backend.assessment import score_detections

    segment = session.get(RoadSegment, segment_id)
    if segment is None:
        return
    observations = session.scalars(select(Observation.id).where(Observation.segment_id == segment_id)).all()
    if not observations:
        session.delete(segment)
        return
    penalties = {"D00": 8.0, "D10": 8.0, "D20": 15.0, "D40": 20.0}
    by_observation: dict[int, float] = {}
    for observation_id in observations:
        detections = session.scalars(select(DamageDetection).where(DamageDetection.observation_id == observation_id)).all()
        values = [penalty for detection in detections for code, penalty in penalties.items() if code in detection.class_name.upper()]
        if values: by_observation[observation_id] = sum(values)
    if not by_observation: return
    avg_penalty = sum(by_observation.values()) / len(by_observation)
    pci = round(max(0.0, 100.0 - avg_penalty), 1)
    exposure = {"trunk": 1.5, "primary": 1.5, "secondary": 1.3, "tertiary": 1.2}.get(segment.road_type, 1.0)
    if segment.near_critical_facility is None:
        try:
            geometry = json.loads(segment.geometry_geojson)
            coords = geometry.get("coordinates", [])
            if geometry.get("type") == "MultiLineString": coords = coords[0] if coords else []
            if coords:
                point = coords[len(coords) // 2]
                from backend.overpass_client import check_nearby_critical_facility
                segment.near_critical_facility, segment.critical_facility_name = check_nearby_critical_facility(float(point[1]), float(point[0]), 300)
        except Exception:
            segment.near_critical_facility = False
    essential = 1.2 if segment.near_critical_facility else 1.0
    mpi = round(min(100.0, avg_penalty * exposure * essential), 2)
    segment.pci_score = pci
    segment.mpi_score = mpi
    segment.priority_tier = "High" if mpi >= 50 else "Medium" if mpi >= 25 else "Low"
    decay = 0.12 * exposure * 1.2
    segment.projected_pci_60d = round(max(0.0, pci - decay * 60), 1)
    segment.days_to_critical = max(0, math.ceil((pci - 50) / decay)) if decay and pci > 50 else 0
    for observation_id, penalty in by_observation.items():
        observation = session.get(Observation, observation_id)
        if observation is None: continue
        item_pci = round(max(0.0, 100.0 - penalty), 1)
        item_mpi = round(min(100.0, penalty * exposure * essential), 2)
        item_priority = "High" if item_mpi >= 50 else "Medium" if item_mpi >= 25 else "Low"
        observation.pci_score, observation.mpi_score, observation.priority_tier = item_pci, item_mpi, item_priority
        if observation.legacy_record_id:
            record = session.get(DetectionRecord, observation.legacy_record_id)
            if record is not None:
                record.pci_proxy, record.mpi_proxy, record.priority = item_pci, item_mpi, item_priority


def delete_analysis(session: Session, record_id: int) -> str | None:
    """Remove one analysis, both saved images, and its normalized assessment rows."""
    record = session.get(DetectionRecord, record_id)
    if record is None:
        return None
    observation = session.scalar(select(Observation).where(Observation.legacy_record_id == record_id))
    segment_id = observation.segment_id if observation else record.road_id
    if observation is not None:
        session.execute(delete(DamageDetection).where(DamageDetection.observation_id == observation.id))
        session.delete(observation)
        session.flush()
    session.execute(delete(ImageAsset).where(ImageAsset.record_id == record_id))
    filename = record.original_filename
    session.delete(record)
    session.flush()
    refresh_road_segment(session, segment_id)
    return filename


def persist_observation(session: Session, record: DetectionRecord, geometry_geojson: str | None) -> Observation:
    """Persist the normalized rows and refresh the score for the matched segment."""
    ensure_road_segment(session, record, geometry_geojson)
    observation = Observation(
        filename=Path(record.image_path).name, original_filename=record.original_filename,
        latitude=record.latitude, longitude=record.longitude,
        geolocated=record.latitude is not None and record.longitude is not None,
        processed=True, raw_path=record.image_path, annotated_path=record.annotated_image_path,
        segment_id=record.road_id if geometry_geojson else None,
        legacy_record_id=record.id, location_status=record.location_status or "no_gps",
        location_source=record.location_source,
        inference_ms=record.inference_ms, pci_score=record.pci_proxy,
        mpi_score=record.mpi_proxy, priority_tier=record.priority,
        created_at=record.created_at,
    )
    session.add(observation)
    session.flush()
    for item in record.detections:
        x1, y1, x2, y2 = item["bbox"]
        session.add(DamageDetection(
            observation_id=observation.id, class_id=item["class_id"],
            class_name=item["class_name"], confidence=item["confidence"],
            bbox_x_center=(x1 + x2) / 2, bbox_y_center=(y1 + y2) / 2,
            bbox_width=max(0.0, x2 - x1), bbox_height=max(0.0, y2 - y1),
        ))
    session.flush()
    refresh_road_segment(session, record.road_id if geometry_geojson else None)
    return observation


def relocate_observation(
    session: Session, observation: Observation, record: DetectionRecord,
    latitude: float, longitude: float, road_match: dict,
    assessment: dict, geometry_geojson: str | None, source: str,
) -> None:
    """Update an existing image location and both affected road scores atomically."""
    previous_segment = observation.segment_id
    record.latitude, record.longitude = latitude, longitude
    record.location_source = source
    for name, value in {**road_match, **assessment}.items():
        setattr(record, name, value)
    ensure_road_segment(session, record, geometry_geojson)
    observation.latitude, observation.longitude = latitude, longitude
    observation.geolocated = True
    observation.location_status = road_match["location_status"]
    observation.location_source = source
    observation.segment_id = record.road_id if geometry_geojson else None
    observation.pci_score = assessment["pci_proxy"]
    observation.mpi_score = assessment["mpi_proxy"]
    observation.priority_tier = assessment["priority"]
    session.flush()
    refresh_road_segment(session, previous_segment)
    if observation.segment_id != previous_segment:
        refresh_road_segment(session, observation.segment_id)
