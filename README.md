# Road Resilience

A prototype for exploring road damage and maintenance review in Bengaluru. It has a React/TypeScript dashboard with a local GeoJSON road map, plus a FastAPI service for YOLO image inference and saved project evidence. The supplied `models/best.pt` matches the checkpoint in `best_model.zip` byte for byte.

## What is implemented

| Part | Current behavior |
| --- | --- |
| Dashboard | Fetches `/api/dashboard` on load and every 30 seconds. It displays saved uploads, optional Mapillary detections, scored road-segment priority totals, model status, and an empty/error state. |
| Road Map, Road Assessment | Fetch `/api/map` and `/api/observations` every 30 seconds. The map draws scored road geometry and uploaded image locations; the queue shows saved analyses and can recheck GPS from a saved image. |
| AI Damage Analysis (`/ai-analysis`) | A toggle shows either single-image or sequential bulk upload. Bulk mode accepts multiple files or a folder, keeps later selections in the queue, and shows original/annotated previews plus each image's result. GPS is read automatically from EXIF or a visible camera-app coordinate stamp. |
| History (`/history`) | Search and page through saved analyses; open each result to view the original and annotated images, detection boxes, coordinates, and PCI/MPI proxies. |
| Model Performance (`/model-performance`) | Shows checkpoint-linked, user-reported overall and per-class validation results. A matching training `results.csv`, when supplied, takes precedence. |
| Backend data endpoints | Read saved uploads and optional Mapillary metadata, detections, and sample images. Uploaded detections include approximate GPS road matching and visual condition proxies. |
| Login and Settings | Presentation UI. The login form navigates to the dashboard without authentication; settings are informational. |

Run AI Damage Analysis to add uploaded detections to the dashboard, map, and review queue. An upload receives coordinates from EXIF GPS or OCR of a labeled decimal coordinate stamp printed on the image. The nearest road line is assigned only within 30 m. Points outside available road coverage still appear on the map, but have no road-segment color. If neither EXIF nor a readable stamp exists, the image remains unlocated. The default checked-in Bengaluru GeoJSON has local feature IDs; an explicit OSMnx import can provide OSM graph-edge IDs. Neither match is field-validated.

## Repository layout

```text
backend/
  main.py                 FastAPI endpoints, model selection, inference, CSV readers
  assessment.py           EXIF GPS, local road matching, prototype visual scoring
  geotag.py               EXIF-first GPS extraction and coordinate-stamp OCR
  annotations.py          Duplicate-box filtering and readable numbered annotations
  database.py             SQLAlchemy observations, detections, road segments, and legacy inference history
  preprocess_rdd.py       Optional OpenCV dataset sanitizer and YOLO label validator
  import_osm.py           Explicit OSMnx road-network import for offline inference
  requirements-gis.txt    Optional GeoPandas and OSMnx dependencies
  docker-compose.yml      Optional PostgreSQL service
  requirements.txt        Python dependencies
models/best.pt            Supplied trained YOLO checkpoint
models/reported_validation.json  User-provided validation output, tied to checkpoint SHA-256
frontend/
  public/bengaluru-roads.geojson  Default local road geometry
  src/pages/              Dashboard and other UI pages
  src/data/               Legacy demo data modules, unused by live map and queue
  src/api.ts              Backend URL and request helpers
  package.json            Frontend scripts and dependencies
```

The project now includes the supplied YOLO checkpoint, the app, GeoJSON, user-provided validation values, and two example result images under `frontend/runs/`. The supplied `best_model.zip` contains only `best.pt`; no diagnostic figures were present in that archive. The checkpoint has 11,137,535 parameters before fusion and 11,127,519 after fusion, exactly matching the supplied training summary's fused count. Its depth/width multipliers of 0.33/0.5 are consistent with YOLOv8 small rather than medium. The project does **not** include the original training CSV, RDD2022 images, or the optional Mapillary CSV/image cache. See [Optional backend artifacts](#optional-backend-artifacts).

## Run locally

Prerequisites: a recent Node.js release compatible with Vite 8 and Python 3.11 or newer. Start the frontend and backend in separate terminals from the repository root. PyTorch installation can be large.

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`). The dashboard, road map, and assessment require the API. The map's OpenStreetMap base tiles need an internet connection; backend matching uses local road files offline.

**Backend**

```bash
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

On the current Windows workspace, Python is not on `PATH`; the already-created local environment can be started with `.venv_short\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`. The `.venv_short` directory is ignored by Git.

The API is at `http://127.0.0.1:8000`; interactive API documentation is at `http://127.0.0.1:8000/docs`. By default, the development frontend calls this address. `/health` can report `status: ok` while its nested `model.status` is `unavailable`; inspect that field to confirm inference readiness. The first model request may take time while Ultralytics loads the checkpoint.

By default, inference history and both original and annotated image bytes use `backend/storage/road_resilience.sqlite3`. Existing disk images under `backend/storage/uploads/` and `backend/storage/annotated/` are copied into the database at startup; the files are retained as a migration backup. New uploads are stored in the database only. This directory is ignored by Git. To use PostgreSQL, start the optional service with `docker compose -f backend/docker-compose.yml up -d` and set `DATABASE_URL` to `postgresql+psycopg://road_user:road_password@localhost:5432/road_resilience` before starting the API. Change those example credentials for a deployed service. The schema is created automatically at startup.

The database stores normalized `observations`, `detections`, and `road_segments` tables. Bounding-box center/width/height values are in source-image pixels. The previous `detection_records` table remains for API compatibility; existing uploads are copied into the normalized tables at startup without inventing GPS data.

To import actual OSM drivable edges, install `backend/requirements-gis.txt` and run `python -m backend.import_osm --place "Bengaluru, Karnataka, India"`. The command writes `data/osm_roads.geojson`; restart the backend to use it. Inference does not call OSMnx or Overpass. With GeoPandas installed, matching uses projected EPSG:32643 distances; otherwise it uses a local meter-scale approximation. Set `ROAD_RESILIENCE_ROADS_FILE` to a different GeoJSON before startup to choose another road file. The checked-in road file remains the offline fallback.

If the RDD2022 training images and YOLO labels are available, run `python -m backend.preprocess_rdd SOURCE_ROOT OUTPUT_ROOT`. This copies images that pass full OpenCV decoding and normalized bounding-box label checks, and reports corrupt, unannotated, invalid-label, and retained counts. It does not modify the source dataset. The reported Kaggle dataset counts in the attached project description cannot be reproduced here because the raw dataset is not included.

## Optional backend artifacts

At startup, the API considers the following checkpoint and metrics pairs, selects the available pair with the highest final valid `mAP50-95` (then `mAP50`), and loads the selected checkpoint on demand:

| Checkpoint | Metrics CSV |
| --- | --- |
| `models/best.pt` | `models/results.csv` |
| `results/full_india_training/yolo11n_full/weights/best.pt` | `results/full_india_training/yolo11n_full/results.csv` |
| `results/compact_training/yolo11n_compact/weights/best.pt` | `results/compact_training/yolo11n_compact/results.csv` |
| `results/training/yolo11n_india/weights/best.pt` | `results/training/yolo11n_india/results.csv` |
| `results/training/yolo11n_india_small/weights/best.pt` | `results/training/yolo11n_india_small/results.csv` |

If no complete pair exists, the API uses the supplied `models/best.pt` and shows `models/reported_validation.json` only when its SHA-256 matches that checkpoint. Those values were transcribed from the user's training console output; the validation images and original run files are unavailable locally. A matching CSV takes precedence and must contain numeric final values for `metrics/precision(B)`, `metrics/recall(B)`, `metrics/mAP50(B)`, and `metrics/mAP50-95(B)`. The API counts `.jpg` files in `train/images`, `val/images`, and `test/images` beneath the selected dataset directory; these counts are zero if the dataset is absent.

Additional optional inputs, relative to the repository root:

```text
data/Mapillary/mapillary_images.csv
data/Mapillary/images/<filename>
results/mapillary_yolo/mapillary_damage_detections.csv
```

The backend reads these local files; it does not fetch images from the live Mapillary API. Missing files yield empty records and samples. Backend observation coordinates come from the saved detection CSV and are not matched to road segments.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | API and model status |
| GET | `/api/model/metrics` | Selected model and saved aggregate validation metrics |
| GET | `/api/roads` | Saved upload and optional Mapillary observations; upload road matches and visual proxy assessments |
| GET | `/api/dashboard/stats` | Aggregated saved-upload and scored-segment counts |
| GET | `/api/observations` | Recent saved image queue; optional `priority`, `limit`, `offset` |
| POST | `/api/observations/{observation_id}/recheck-location` | Read GPS again from a saved original image; refresh road scores |
| GET | `/api/map` | GeoJSON layer of matched road segments and priority colors |
| GET | `/api/dashboard` | Counts and history from saved uploads and optional Mapillary files |
| GET | `/api/detections` | Paginated saved upload history (`limit`, `offset`, optional filename `query`); includes total count |
| GET | `/api/detections/{record_id}` | One saved upload result |
| GET | `/api/detections/{record_id}/image` | Saved annotated JPEG |
| GET | `/api/detections/{record_id}/original` | Saved original image |
| GET | `/api/mapillary` | Saved image metadata with associated detections |
| GET | `/api/samples` | Available local sample images |
| GET | `/api/samples/{filename}` | A local sample JPEG |
| POST | `/api/damage/analyze` | Multipart image field named `file`; saves inference and returns detections and a base64 JPEG annotation |
| POST | `/api/upload` | Alias for the same upload and inference pipeline |

For example:

```bash
curl -F "file=@road.jpg" http://127.0.0.1:8000/api/damage/analyze
```

Uploads must have an image content type, be readable by Pillow, and be no larger than 15 MB each. The default confidence threshold is `0.25` and inference size is `960`. For images without EXIF GPS, RapidOCR looks for labeled decimal `Lat` and `Long` values near the top or bottom of the image. OCR may fail on blurred, cropped, or differently formatted stamps; it never guesses coordinates. In bulk mode, **Add images** and **Add folder** append image files to a visible queue; non-image files are skipped. The UI sends one `/api/upload` request at a time, continues after individual failures, and shows per-image progress, annotated previews, and results. It passes `include_annotated_image=false` to omit the large base64 annotation from each response; the saved annotated JPEG remains available at `annotated_image_url`. The single-image flow still returns the inline annotation.

When two detections cover nearly the same pixels (intersection over union at least `0.85`), the higher-confidence label is kept. Annotated images use numbered boxes and a separate legend so class labels do not overlap. Existing saved records with duplicate boxes are repaired on backend startup.

## Configuration and deployment

| Variable | Used by | Default |
| --- | --- | --- |
| `VITE_API_URL` | Frontend | `http://127.0.0.1:8000` in development; same-origin `/api` in production when unset |
| `ROAD_RESILIENCE_CORS` | Backend | `http://localhost:5173,http://127.0.0.1:5173` |
| `ROAD_RESILIENCE_CONFIDENCE` | Backend | `0.25` |
| `ROAD_RESILIENCE_IMAGE_SIZE` | Backend | `960` |
| `ROAD_RESILIENCE_ROADS_FILE` | Backend | `data/osm_roads.geojson` when present, otherwise checked-in local GeoJSON |
| `DATABASE_URL` | Backend | SQLite database under `backend/storage/` |

### One Vercel project with frontend and backend services

The root `vercel.json` defines a Vite `frontend` service and a FastAPI `backend` service. Public `/api/*` and `/health` requests reach the backend; other paths reach the frontend. The browser calls the public same-origin API path, so no service-to-service binding is used. The backend service uses the repository root because its Python imports, checkpoint, and fallback road file are outside `backend/`. The root `requirements.txt` delegates to `backend/requirements.txt`.

1. Push the repository, including `models/best.pt`, to GitHub. In Vercel, import it as **one project**, choose **Services** as the framework, and keep the project Root Directory at the repository root.
2. Provision a persistent PostgreSQL database and set `DATABASE_URL` in the Vercel project to its connection URL. Do not use the default SQLite file for hosted uploads: Vercel Functions have a read-only deployment filesystem and temporary scratch storage, so a local SQLite file cannot preserve analysis history.
3. Deploy, check `/health` including `model.status`, then upload a geotagged image and verify it appears in History and the map. `VITE_API_URL` should be unset for this one-domain setup. `ROAD_RESILIENCE_CORS` is only needed if another website calls the API across origins.
4. To bring existing local history online, set `DATABASE_URL` locally to the new database's external URL and run `python -m backend.migrate_sqlite_to_postgres` before hosted uploads. The command requires an empty destination database and copies the saved images and records.

PyTorch, Ultralytics, OpenCV, OCR, and the checkpoint make the backend a large Python function. Check Vercel's function package, memory, and duration limits for the chosen plan; a deployment build and live inference test are still needed. The local SQLite file and uploaded images are ignored by Git. Public image endpoints and upload APIs have no authentication, so restrict access before using sensitive imagery.

### Alternative: Vercel frontend + Render backend

1. Push this repository, including `models/best.pt`, to GitHub. The local SQLite database under `backend/storage/` stays out of Git.
2. In Render, create a Blueprint from the repository's `render.yaml`. Its Docker web service runs FastAPI and the checkpoint; its managed PostgreSQL database stores observations and both image versions. The checked-in plans (`1c-2g` web, `0.1c-256mb` database) are **paid**. Review the charges before creating them. A free PostgreSQL preview expires after 30 days, and the free web instance's 512 MB memory may be insufficient for PyTorch inference.
3. If using a separate Vercel frontend project, import the same repository with **Root Directory** `frontend`, **Framework Preset** Vite, **Build Command** `npm run build`, and **Output Directory** `dist`. Set `VITE_API_URL` to the Render service's HTTPS origin (no trailing slash), then deploy or redeploy. Vite embeds this value during the build.
4. In the Render web service, set `ROAD_RESILIENCE_CORS` to the Vercel production origin, such as `https://your-project.vercel.app`, and redeploy. For additional preview domains, add their origins separated by commas. Check Render `/health`, then open the Vercel site and run one test upload.
5. To bring the existing local history online, set `DATABASE_URL` on your local machine to the **external** Render PostgreSQL URL and run `python -m backend.migrate_sqlite_to_postgres`. This one-time command requires an empty destination database, copies all image bytes and records, and prints table row counts. Do not commit the URL or local database. Run it before new uploads are added to the hosted database.

In this alternative setup, the frontend and backend are separate sites. The backend's root path is not the dashboard; `/health` and `/docs` are available there.

## Scope and limitations

- The map and assessment use saved uploads. A point can use EXIF GPS or a readable coordinate stamp. Road-segment colors require a match within 30 m and a scored D00/D10/D20/D40 detection. Optional Mapillary CSV observations remain outside the normalized upload and road-segment scores.
- The attached specification's formula is implemented as a **visual proxy**: `PCI = max(0, 100 - sum(class weight × detection count))`, with D00/D10=8, D20=15, and D40=20. `MPI = (100 - PCI) × road-class factor`, with major=1.5, collector=1.2, and local/unknown=1.0. High is MPI ≥50, medium ≥25, otherwise low. The checkpoint's fifth `Other_Damage` class has no specified weight and is excluded from scoring. These values are not ASTM PCI or measured traffic criticality. Images without a scored class remain unassessed.
- The shown per-class and overall validation values come from the user-provided training output, are labeled as reported, and are linked to the checkpoint hash. They are not a local validation rerun and do not measure accuracy on uploaded images or Mapillary deployment observations. If a matching training CSV is added, its aggregate values replace the reported summary.
- GPS snapping uses the checked-in Bengaluru GeoJSON by default and a 30 m threshold. It does not validate direction, GPS accuracy, imagery position, or road ownership. The default file has only a small local coverage area and no verified OSM graph-edge IDs. There is no authenticated account system, traffic or maintenance history, or environmental vulnerability model. Uploaded image bytes and detection history are stored in the database; a public deployment needs access control before accepting sensitive uploads.
- The supplied training console output reports 5,758 validation images, 9,740 instances, class metrics, and 4.6 ms inference in its training environment. The archive supplies only a YOLOv8s-scale checkpoint; the training CSV, validation images, and raw data remain absent. The UI labels these figures as user-reported rather than independently verified.

## Development checks

From `frontend/`, run `npm run build` for TypeScript and production build validation, and `npm run lint` for ESLint.
From the repository root, run `python -m unittest backend.test_pipeline -v` to check GPS parsing, road matching, scoring, and upload persistence. The API integration test uses a temporary SQLite database and the supplied checkpoint.
