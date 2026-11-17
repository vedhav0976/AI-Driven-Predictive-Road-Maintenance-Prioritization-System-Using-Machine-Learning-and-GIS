# Road Resilience

A prototype for exploring road damage and maintenance review in Bengaluru. It has a React/TypeScript dashboard with a local GeoJSON road map, plus a FastAPI service for YOLO image inference and saved project evidence. `models/best.pt` is the checkpoint from the supplied `new_best_model.zip` archive.

## What is implemented

| Part | Current behavior |
| --- | --- |
| Dashboard | Fetches `/api/dashboard` on load and every 30 seconds. It displays saved uploads, optional Mapillary detections, scored road-segment priority totals, model status, and an empty/error state. |
| Road Map, Road Assessment | Fetch `/api/map` and `/api/observations` every 30 seconds. The map draws scored local or Overpass road geometry and priority-colored image locations; the queue shows saved analyses, nearby critical facilities, and a 60-day PCI projection, and can recheck GPS from a saved image. |
| AI Damage Analysis (`/ai-analysis`) | Single-image or sequential queue analysis. One Add button accepts local images, a local folder, public Drive links, or selected Mapillary images. A map-area search shows Mapillary thumbnails, capture dates, and contributor credits. Coordinates come from EXIF, a readable image stamp, or the Mapillary API. |
| History (`/history`) | Search and page through saved analyses; open each result to view the original and annotated images, detection boxes, coordinates, and PCI/MPI proxies. |
| Model Performance (`/model-performance`) | Shows aggregate validation metrics from the active checkpoint's matching `results.csv`, when available, and identifies the checkpoint's class labels. |
| Backend data endpoints | Read saved uploads and optional Mapillary metadata, detections, and sample images. Uploaded detections include approximate GPS road matching and visual condition proxies. |
| Workspace entry and Settings | A public “Open workspace” entry leads to the dashboard. Settings explain storage and assessment rules; account authentication is not configured. |

Run AI Damage Analysis to add uploaded detections to the dashboard, map, and review queue. An upload receives coordinates from EXIF GPS or OCR of a labeled decimal coordinate stamp printed on the image. Road matching checks configured local GeoJSON first, then queries the public Overpass API for a drivable OSM road within 30 m. Dynamically matched OSM ways and their geometry are saved in `road_segments`, so later matching can reuse them. If no road is found or Overpass is unavailable, the image still saves and appears as an unassigned map point. Neither GPS matching nor OSM road attributes are field-validated.

## Repository layout

```text
backend/
  main.py                 FastAPI endpoints, model selection, inference, CSV readers
  assessment.py           EXIF GPS, local road matching, prototype visual scoring
  overpass_client.py      Public Overpass mirror requests for nearby roads and essential services
  geotag.py               EXIF-first GPS extraction and coordinate-stamp OCR
  annotations.py          Duplicate-box filtering and readable numbered annotations
  database.py             SQLAlchemy observations, detections, road segments, and legacy inference history
  preprocess_rdd.py       Optional OpenCV dataset sanitizer and YOLO label validator
  import_osm.py           Explicit OSMnx road-network import for offline inference
  requirements-gis.txt    Optional GeoPandas and OSMnx dependencies
  docker-compose.yml      Optional PostgreSQL service
  requirements.txt        Python dependencies
models/best.pt            Current YOLOv8s checkpoint (2 damage classes)
models/results.csv        Matching validation metrics from the current training run
models/args.yaml          Matching training configuration
frontend/
  public/bengaluru-roads.geojson  Default local road geometry
  src/pages/              Dashboard and other UI pages
  src/data/               Legacy demo data modules, unused by live map and queue
  src/api.ts              Backend URL and request helpers
  package.json            Frontend scripts and dependencies
```

The current checkpoint and matching `results.csv` and `args.yaml` came from `new_best_model.zip`. The training configuration identifies a YOLOv8s detector trained for 50 epochs; the checkpoint reports two labels: `D20_Alligator_Crack` and `D40_Pothole`. The final CSV row reports precision 0.89392, recall 0.67355, mAP50 0.75906, and mAP50-95 0.34278. These are training-run validation metrics, not a new independent evaluation. The training dataset and its images are not included. See [Optional backend artifacts](#optional-backend-artifacts).

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

The checked-in Bengaluru GeoJSON is the fast local road source. When it has no road within 30 m, the API queries public Overpass mirrors for nearby drivable OSM ways. Requests include a descriptive User-Agent and an eight-second timeout; mirror/network failures fail open and do not block inference. Matching Overpass ways are cached in `road_segments` and reused locally. A separate Overpass query checks for hospitals, clinics, schools, colleges, fire stations, and police facilities within 300 m; its nullable result is cached per road segment. Overpass does not require an API key, but the public endpoints can be rate-limited or temporarily unavailable. With GeoPandas installed, local matching uses projected EPSG:32643 distances; otherwise it uses a local meter-scale approximation. Set `ROAD_RESILIENCE_ROADS_FILE` to select another local GeoJSON. The optional OSMnx importer can still pre-load a larger network for offline matching.

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

The current pair is `models/best.pt` and `models/results.csv`; `models/args.yaml` records its training configuration. The CSV must contain numeric final values for `metrics/precision(B)`, `metrics/recall(B)`, `metrics/mAP50(B)`, and `metrics/mAP50-95(B)`. The API counts `.jpg` files in `train/images`, `val/images`, and `test/images` beneath the selected dataset directory; these counts are unavailable because the training dataset is not included.

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
| POST | `/api/observations/{observation_id}/recheck-location` | Read GPS again from a saved original image; refresh road scores and return facility/projection fields |
| GET | `/api/map` | GeoJSON layer of matched local/OSM road segments, priority colors, facility cache, and 60-day PCI projection |
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

### Current Vercel deployment (API migration pending)

The dashboard is deployed as the `road-maintenance-ai` Vercel project at `https://road-maintenance-ai.vercel.app`, with Root Directory `frontend` and framework Vite. The API is currently deployed separately as `road-maintenance-api` at `https://road-maintenance-api.vercel.app`, from the repository root. This Vercel API deployment includes the large PyTorch/Ultralytics inference stack and checkpoint. The migration below moves the API to Render to reduce Vercel Function Storage use; keep the existing API deployment until the Render API has been verified.

The dashboard currently calls the separate Vercel API using the Vite build-time `VITE_API_URL`. The active database is Supabase. The current Vercel API can remain available during migration; do not delete it or change the frontend API URL until the Render service has been verified.

To delete a saved analysis, open it from **History**, choose **Delete analysis**, enter the deletion key, and confirm. This removes the analysis, original and annotated image bytes, and its road observation from the active database; the affected road segment score is recalculated. Configure `ROAD_RESILIENCE_DELETE_KEY` as a secret environment variable on the API project, then redeploy the API. Keep the key out of Git and share it only with administrators. Deletion does not remove records from separately retained database backups.

For shared Drive folders, enable the Google Drive API in a Google Cloud project, create an API key restricted to the Drive API, and set `GOOGLE_DRIVE_API_KEY` as a secret in the API service. Redeploy the API after adding it. Links must be shared as **Anyone with the link**. Individual public image links can use Drive's download link without a key; some Drive files may still require the API key or may not allow automated downloads. Only images directly inside the shared folder are listed (up to 200 per import). Private Drive links require OAuth and are not supported.

### Live Mapillary imagery

1. Create or use a client access token from the [Mapillary developer dashboard](https://www.mapillary.com/dashboard/developers). Store it as `MAPILLARY_ACCESS_TOKEN` in the repository root `.env` or `.env.local`. The backend reads these files at startup without overriding already-set environment variables. These files are ignored by Git and Vercel uploads. Keep the token on the backend; do not prefix it with `VITE_`.
2. For the hosted app, set that variable as a secret on the API service and redeploy it. The dashboard needs no Mapillary token.
3. Open **AI Damage Analysis → Bulk upload → Mapillary imagery**. Pan/zoom the map to a small road area, choose **Search this area**, select images, use the existing **Add to queue** button, then **Run analysis**. Up to 24 images are shown per UI search; the initial map centers on Bengaluru. Search supports other areas, while road snapping uses only the configured road geometry.
4. Each selected image is downloaded by ID through the server and analyzed one at a time with the same YOLO, GIS, PCI/MPI proxy, and persistence pipeline. Mapillary API coordinates are used because downloaded thumbnails may omit EXIF. Original and annotated bytes plus source ID, creator, image URL, capture time, coordinate source, and license are stored in the active database. A unique source-image index prevents repeated analyses of the same Mapillary image from inflating road scores. Existing records remain readable after the additive schema update.

Mapillary imagery is licensed under [CC BY-SA 4.0](https://help.mapillary.com/hc/en-us/articles/115001770409-CC-BY-SA-license-for-open-data). The picker, queue, saved images, and map popups retain source/creator/license attribution; annotated images are identified as modified by Road Resilience. Inspect the **capture date** before using a result for maintenance planning: Mapillary imagery is historical evidence and may not show today's road condition. Model accuracy on Mapillary imagery has not been validated locally; panoramas and small thumbnails may differ from the training data.

Run `python -m backend.check_mapillary --download` to verify token access, Bengaluru search, and an in-memory image download without creating a database record. API credentials travel only to the Mapillary Graph host; image downloads accept trusted Mapillary/Meta CDN URLs returned by the provider, have timeouts and a 15 MB cap, and do not forward the API token to the CDN.

Dense Mapillary searches can time out at the provider. The backend searches larger map areas as four smaller requests in parallel, with a bounded fallback for smaller areas that time out. It merges and deduplicates the results; if only part of the area loads, the picker keeps those images selectable and shows a partial-search notice. Zoom in to a shorter road section to retry areas that remain unavailable. Authentication and rate-limit errors are reported directly.

PyTorch, Ultralytics, OpenCV, OCR, and the checkpoint make the backend a large Python deployment. Vercel Functions limit request bodies to 4.5 MB, so larger image uploads need a direct-to-storage flow or another backend host. The local SQLite file and uploaded images are ignored by Git. Public image endpoints and upload APIs have no authentication, so restrict access before using sensitive imagery.

### Move the API to Render and keep the frontend on Vercel

This setup keeps the existing Supabase database; it does not provision a second Render database or require a data migration.

1. Push the repository, including `models/best.pt`, to GitHub. Keep `.env*`, `backend/storage/`, and local databases out of Git.
2. Create a Render Blueprint from `render.yaml` and review the paid `1c-2g` Docker web service before confirming. The blueprint intentionally does not create a database. The Render service needs the existing Supabase PostgreSQL connection string, deletion secret, and Mapillary token. Enter these only in Render's secret environment-variable form; do not commit them. Use the Supabase session-pooler connection string so existing analyses remain visible.
3. Wait for the service URL, then check `https://<render-service>.onrender.com/health`. Confirm the response reports the model ready before changing the frontend.
4. In the Vercel frontend project, set Production `VITE_API_URL` to the Render service's HTTPS origin (no trailing slash), then redeploy the frontend. Vite embeds this public URL at build time.
5. In Render, set `ROAD_RESILIENCE_CORS` to `https://road-maintenance-ai.vercel.app` (the production value in the blueprint). Add any preview origins as needed. Test dashboard loading, History/images, Mapillary, and one controlled image upload.
6. Once the Vercel frontend is confirmed to use Render, disable Git auto-deploys for the old Vercel API project and remove old preview/failed API deployments you no longer need. Keep the current production API deployment until cutover is verified, then delete the old Vercel API project if it is no longer needed. This prevents repeated large ML function deployments from continuing to consume Vercel Function Storage.

The frontend and backend are separate sites. The API root path is not the dashboard; `/health` and `/docs` are available there. Render's `1c-2g` service plan is paid. Do not replace `DATABASE_URL` with a new Render database unless intentionally planning a separate data migration.
## Scope and limitations

- The map and assessment use saved uploads. A point can use EXIF GPS or a readable coordinate stamp. Road-segment colors require a match within 30 m and a scored D00/D10/D20/D40 detection. Optional Mapillary CSV observations remain outside the normalized upload and road-segment scores.
- The assessment is a **visual proxy**, not a certified PCI survey. For each observation, `PCI = max(0, 100 - sum(class weight × detection count))`, with D00/D10=8, D20=15, and D40=20. For a road segment, PCI averages the per-observation penalties so repeated uploads do not accumulate without bound. `MPI = min(100, (100 - PCI) × road exposure × facility factor)`: trunk/primary exposure=1.5, secondary=1.3, tertiary=1.2, other/local=1.0; segments within 300 m of a cached essential service receive a 1.2 facility factor. Priority is High at MPI ≥50, Medium at ≥25, otherwise Low. The 60-day estimate subtracts `0.12 × road exposure × 1.2` PCI points per day (capped at zero); days-to-critical estimates time to PCI 50. This is an illustrative projection, not a trained deterioration forecast. The active checkpoint detects D20 and D40 only; D00/D10 weights remain for compatible checkpoints. Images without a scored class remain unassessed.
- The shown per-class and overall validation values come from the user-provided training output, are labeled as reported, and are linked to the checkpoint hash. They are not a local validation rerun and do not measure accuracy on uploaded images or Mapillary deployment observations. If a matching training CSV is added, its aggregate values replace the reported summary.
- GPS snapping uses checked-in local GeoJSON first, then live Overpass within 30 m. Results depend on public OSM coverage and Overpass availability and do not validate direction, GPS accuracy, imagery position, road ownership, or road condition. Facility lookups are cached once per segment, including a negative result after a successful query. There is no authenticated account system, measured traffic or maintenance history, or validated deterioration model. Uploaded image bytes and detection history are stored in the database; a public deployment needs access control before accepting sensitive uploads.
- The current training archive includes aggregate validation metrics in `models/results.csv`, but not per-class validation metrics, validation images, or the training dataset. Its final reported inference time should not be treated as deployed service latency. The checkpoint and CSV are used directly by the model-performance page; these values have not been independently reproduced here.

## Development checks

From `frontend/`, run `npm run build` for TypeScript and production build validation, and `npm run lint` for ESLint.
From the repository root, run `python -m unittest backend.test_pipeline backend.test_overpass -v` to check GPS parsing, road matching, scoring, upload persistence, Overpass parsing, timeout fallback, facility detection, and cache behavior. The API integration test uses a temporary SQLite database and the supplied checkpoint. Build the UI with `npm --prefix frontend run build`.
