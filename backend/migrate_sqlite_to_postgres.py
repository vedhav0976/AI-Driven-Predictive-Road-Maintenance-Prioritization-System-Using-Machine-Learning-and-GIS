"""Copy the complete local inference database into an empty PostgreSQL database.

Usage: set DATABASE_URL to the Render Postgres external URL, then run
``python -m backend.migrate_sqlite_to_postgres`` from the repository root.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from sqlalchemy import create_engine, func, inspect, select, text

from backend.database import Base, STORAGE_ROOT


SEQUENCE_TABLES = ("detection_records", "observations", "detections")


def copy_database(source_path: Path, target_url: str) -> dict[str, int]:
    if not source_path.is_file():
        raise ValueError(f"Source SQLite database does not exist: {source_path}")
    if target_url.startswith("postgres://"):
        target_url = "postgresql+psycopg://" + target_url[len("postgres://"):]
    elif target_url.startswith("postgresql://"):
        target_url = "postgresql+psycopg://" + target_url[len("postgresql://"):]
    if not target_url.startswith("postgresql+psycopg://"):
        raise ValueError("DATABASE_URL must be a PostgreSQL connection URL.")

    source = create_engine(f"sqlite:///{source_path.resolve().as_posix()}")
    target = create_engine(target_url, pool_pre_ping=True)
    counts: dict[str, int] = {}
    try:
        Base.metadata.create_all(target)
        source_tables = set(inspect(source).get_table_names())
        with source.connect() as from_connection, target.begin() as to_connection:
            for table in Base.metadata.sorted_tables:
                existing = to_connection.scalar(select(func.count()).select_from(table))
                if existing:
                    raise ValueError(f"Target is not empty: {table.name} contains {existing} row(s). No data was copied.")
            for table in Base.metadata.sorted_tables:
                if table.name not in source_tables:
                    raise ValueError(f"Source database is missing required table: {table.name}")
                rows = [dict(row) for row in from_connection.execute(select(table)).mappings()]
                if rows:
                    to_connection.execute(table.insert(), rows)
                counts[table.name] = len(rows)
            for table_name in SEQUENCE_TABLES:
                to_connection.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), "
                    f"GREATEST(COALESCE((SELECT MAX(id) FROM {table_name}), 0), 1), "
                    f"(SELECT MAX(id) IS NOT NULL FROM {table_name}))"
                ))
    finally:
        source.dispose()
        target.dispose()
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=STORAGE_ROOT / "road_resilience.sqlite3")
    arguments = parser.parse_args()
    destination = os.getenv("DATABASE_URL")
    if not destination:
        parser.error("Set DATABASE_URL to the destination PostgreSQL external connection URL.")
    for name, count in copy_database(arguments.source, destination).items():
        print(f"{name}: {count} row(s) copied")
