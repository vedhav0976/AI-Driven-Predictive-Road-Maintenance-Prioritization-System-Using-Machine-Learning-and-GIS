# Road Resilience

A prototype for exploring road damage and maintenance review in Bengaluru. It has a React/TypeScript dashboard with a local GeoJSON road map, plus a FastAPI service for YOLO image inference and saved project evidence. The supplied `models/best.pt` matches the checkpoint in `best_model.zip` byte for byte.

## What is implemented

| Part | Current behavior |
| --- | --- |
| Dashboard | Fetches `/api/dashboard` on load and every 30 seconds. It displays saved uploads, optional Mapillary detections, scored road-segment priority totals, model status, and an empty/error state. |
| Road Map, Road Assessment | Fetch `/api/map` and `/api/observations` every 30 seconds. The map draws scored road geometry and uploaded image locations; the queue shows saved analyses and can recheck GPS from a saved image. |
| AI Damage Analysis (`/ai-analysis`) | Single-image or sequential queue analysis. One Add button accepts local images, a local folder, public Drive links, or selected Mapillary images. A map-area search shows Mapillary thumbnails, capture dates, and contributor credits. Coordinates come from EXIF, a readable image stamp, or the Mapillary API. |
| History (`/history`) | Search and page through saved analyses; open each result to view the original and annotated images, detection boxes, coordinates, and PCI/MPI proxies. |
| Model Performance (`/model-performance`) | Shows checkpoint-linked, user-reported overall and per-class validation results. A matching training `results.csv`, when supplied, takes precedence. |
| Backend data endpoints | Read saved uploads and optional Mapillary metadata, detections, and sample images. Uploaded detections include approximate GPS road matching and visual condition proxies. |
| Workspace entry and Settings | A public “Open workspace” entry leads to the dashboard. Settings explain storage and assessment rules; account authentication is not configured. |

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
| DELETE | `/api/detections/{record_id}` | Delete one saved analysis and its images; requires `X-Delete-Key` |
| GET | `/api/detections/{record_id}/image` | Saved annotated JPEG |
| GET | `/api/detections/{record_id}/original` | Saved original image |
| GET | `/api/mapillary` | Saved image metadata with associated detections |
| GET | `/api/mapillary/status` | Whether the server has a Mapillary token configured; never returns the token |
| GET | `/api/mapillary/search` | Live imagery in `bbox=west,south,east,north`; up to 50 results, maximum 0.1 degrees per side |
| POST | `/api/mapillary/analyze` | Analyze `{"image_id":"..."}` using Mapillary imagery and API coordinates; reuse an existing saved result for the same image |
| GET | `/api/samples` | Available local sample images |
| GET | `/api/samples/{filename}` | A local sample JPEG |
| POST | `/api/damage/analyze` | Multipart image field named `file`; saves inference and returns detections and a base64 JPEG annotation |
| POST | `/api/upload` | Alias for the same upload and inference pipeline |
| POST | `/api/drive/list` | List supported images in a public Google Drive folder; requires server-side `GOOGLE_DRIVE_API_KEY` |
| POST | `/api/drive/analyze` | Download one public Drive image, then save it through the same inference pipeline |

For example:

```bash
curl -F "file=@road.jpg" http://127.0.0.1:8000/api/damage/analyze
```

Uploads must have an image content type, be readable by Pillow, and be no larger than 15 MB each. The default confidence threshold is `0.25` and inference size is `960`. For images without EXIF GPS, RapidOCR looks for labeled decimal `Lat` and `Long` values near the top or bottom of the image. OCR may fail on blurred, cropped, or differently formatted stamps; it never guesses coordinates. In queue mode, select **Images on device**, **Folder on device**, or **Google Drive link**, then use the same **Add to queue** button. Public Drive file links add one image; public Drive folder links list supported images when the API key is configured. The UI processes queue items one at a time, continues after individual failures, and shows per-image progress and results. It omits the large base64 annotation from queue responses; the saved annotated JPEG remains available at `annotated_image_url`. The single-image flow still returns the inline annotation.

When two detections cover nearly the same pixels (intersection over union at least `0.85`), the higher-confidence label is kept. Annotated images use numbered boxes and a separate legend so class labels do not overlap. Existing saved records with duplicate boxes are repaired on backend startup.

## Configuration and deployment

| Variable | Used by | Default |
| --- | --- | --- |
| `VITE_API_URL` | Frontend | `http://127.0.0.1:8000` in development; set to the separate API origin in production |
| `ROAD_RESILIENCE_CORS` | Backend | `http://localhost:5173,http://127.0.0.1:5173` |
| `ROAD_RESILIENCE_CONFIDENCE` | Backend | `0.25` |
| `ROAD_RESILIENCE_IMAGE_SIZE` | Backend | `960` |
| `ROAD_RESILIENCE_ROADS_FILE` | Backend | `data/osm_roads.geojson` when present, otherwise checked-in local GeoJSON |
| `GOOGLE_DRIVE_API_KEY` | Backend | Unset; required to list public Drive folders, optional for a public Drive image file |
| `MAPILLARY_ACCESS_TOKEN` | Backend | Unset; enables live Mapillary imagery search and analysis |
| `ROAD_RESILIENCE_DELETE_KEY` | Backend | Unset; deletion is disabled until a secret key is configured |
| `DATABASE_URL` or `POSTGRES_URL_NON_POOLING` | Backend | SQLite database under `backend/storage/` when neither is set |

### Vercel dashboard and API on separate addresses

The dashboard is deployed as the `road-maintenance-ai` Vercel project at `https://road-maintenance-ai.vercel.app`, with Root Directory `frontend` and framework Vite. Its `frontend/vercel.json` serves client-side routes such as `/history`. The API is the `road-maintenance-api` project at `https://road-maintenance-api.vercel.app`, built from the repository root with the FastAPI service in the root `vercel.json`. The API needs the repository root for imports and `models/best.pt`; Vercel installs `backend/requirements.txt`, which pins CPU-only PyTorch and headless OpenCV. The root `requirements.txt` includes it for local setup.

1. Connect both Vercel projects to this GitHub repository. Set the dashboard project Root Directory to `frontend` and framework to Vite; keep the API project at the repository root with the Services framework.
2. Set dashboard `VITE_API_URL=https://road-maintenance-api.vercel.app` for Production and Preview. Vite embeds this public origin at build time. Set API `ROAD_RESILIENCE_CORS=https://road-maintenance-ai.vercel.app` and `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` for Production and Preview.
3. Connect a Supabase PostgreSQL resource to the API project. Its `POSTGRES_URL_NON_POOLING` is a session-pooler connection that works with SQLAlchemy and Psycopg. The API uses `DATABASE_URL` if explicitly set, then `POSTGRES_URL_NON_POOLING`, then `POSTGRES_URL`. Do not use the default SQLite file on Vercel because deployment storage is read-only.
4. Check the API `/health` and `model.status`, then open the dashboard and verify History and images. The four pre-deployment analyses were copied from Neon to Supabase using `python -m backend.migrate_postgres_to_postgres`; that command needs Neon `DATABASE_URL` and prefixed Supabase `SUPABASE_POSTGRES_URL_NON_POOLING` in its environment and requires an empty destination database.

To delete a saved analysis, open it from **History**, choose **Delete analysis**, enter the deletion key, and confirm. This removes the analysis, original and annotated image bytes, and its road observation from the active database; the affected road segment score is recalculated. Configure `ROAD_RESILIENCE_DELETE_KEY` as a secret environment variable on the API project, then redeploy the API. Keep the key out of Git and share it only with administrators. Deletion does not remove records from separately retained database backups.

For shared Drive folders, enable the Google Drive API in a Google Cloud project, create an API key restricted to the Drive API, and set `GOOGLE_DRIVE_API_KEY` as a secret in the API Vercel project. Redeploy the API after adding it. Links must be shared as **Anyone with the link**. Individual public image links can use Drive's download link without a key; some Drive files may still require the API key or may not allow automated downloads. Only images directly inside the shared folder are listed (up to 200 per import). Private Drive links require OAuth and are not supported.

### Live Mapillary imagery

1. Create or use a client access token from the [Mapillary developer dashboard](https://www.mapillary.com/dashboard/developers). Store it as `MAPILLARY_ACCESS_TOKEN` in the repository root `.env` or `.env.local`. The backend reads these files at startup without overriding already-set environment variables. These files are ignored by Git and Vercel uploads. Keep the token on the backend; do not prefix it with `VITE_`.
2. For the hosted app, set that variable as a secret on the **API** Vercel project and redeploy it. The dashboard needs no Mapillary token.
3. Open **AI Damage Analysis → Bulk upload → Mapillary imagery**. Pan/zoom the map to a small road area, choose **Search this area**, select images, use the existing **Add to queue** button, then **Run analysis**. Up to 24 images are shown per UI search; the initial map centers on Bengaluru. Search supports other areas, while road snapping uses only the configured road geometry.
4. Each selected image is downloaded by ID through the server and analyzed one at a time with the same YOLO, GIS, PCI/MPI proxy, and persistence pipeline. Mapillary API coordinates are used because downloaded thumbnails may omit EXIF. Original and annotated bytes plus source ID, creator, image URL, capture time, coordinate source, and license are stored in the active database. A unique source-image index prevents repeated analyses of the same Mapillary image from inflating road scores. Existing records remain readable after the additive schema update.

Mapillary imagery is licensed under [CC BY-SA 4.0](https://help.mapillary.com/hc/en-us/articles/115001770409-CC-BY-SA-license-for-open-data). The picker, queue, saved images, and map popups retain source/creator/license attribution; annotated images are identified as modified by Road Resilience. Inspect the **capture date** before using a result for maintenance planning: Mapillary imagery is historical evidence and may not show today's road condition. Model accuracy on Mapillary imagery has not been validated locally; panoramas and small thumbnails may differ from the training data.

Run `python -m backend.check_mapillary --download` to verify token access, Bengaluru search, and an in-memory image download without creating a database record. API credentials travel only to the Mapillary Graph host; image downloads accept trusted Mapillary/Meta CDN URLs returned by the provider, have timeouts and a 15 MB cap, and do not forward the API token to the CDN.

PyTorch, Ultralytics, OpenCV, OCR, and the checkpoint make the backend a large Python function. A deployed build and public API health check passed; a live image inference request has not yet been tested. Vercel Functions limit request bodies to 4.5 MB, so larger image uploads need a direct-to-storage flow or another backend host. The local SQLite file and uploaded images are ignored by Git. Public image endpoints and upload APIs have no authentication, so restrict access before using sensitive imagery.

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
