"""Copy hosted analysis history from one PostgreSQL database to an empty one.

Reads DATABASE_URL for the source and SUPABASE_POSTGRES_URL_NON_POOLING
for the destination.
Neither connection string is printed.
"""

from __future__ import annotations

import os

from sqlalchemy import create_engine

from backend.migrate_sqlite_to_postgres import copy_tables, postgres_url


def main() -> None:
    source_url = os.getenv("DATABASE_URL")
    target_url = os.getenv("SUPABASE_POSTGRES_URL_NON_POOLING")
    if not source_url or not target_url:
        raise SystemExit("Set DATABASE_URL and SUPABASE_POSTGRES_URL_NON_POOLING before migrating.")
    source = create_engine(postgres_url(source_url), pool_pre_ping=True)
    target = create_engine(postgres_url(target_url), pool_pre_ping=True)
    try:
        if source.url == target.url:
            raise ValueError("Source and destination must be different databases.")
        for name, count in copy_tables(source, target).items():
            print(f"{name}: {count} row(s) copied")
    finally:
        source.dispose()
        target.dispose()


if __name__ == "__main__":
    main()
