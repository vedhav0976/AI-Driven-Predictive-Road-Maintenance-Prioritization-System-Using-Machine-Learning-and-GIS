# Road Resilience frontend

React, TypeScript, and Vite frontend for the Road Resilience prototype. See the [project README](../README.md) for architecture, setup, backend artifacts, API, and limitations.

```bash
npm install
npm run dev
```

The dashboard loads saved uploads and optional Mapillary observations from FastAPI. AI Damage Analysis has a single/bulk toggle. Bulk mode adds images or a folder to a visible queue, processes files one at a time, and shows both image previews and each result. GPS is read automatically from EXIF metadata or a visible coordinate stamp. Road Assessment can recheck GPS from a saved image. The History menu searches saved analyses and opens their original and annotated images with detection details. The road map and road assessment load saved analyses from `/api/map` and `/api/observations`, refreshing every 30 seconds. The model pages are available from the sidebar.

For a single Vercel project with services, use the repository-root `vercel.json` and leave `VITE_API_URL` unset. The browser then calls `/api` on the same domain. For a separate frontend project with a Render backend, set the project root to `frontend`, set `VITE_API_URL` to Render's HTTPS origin, and add the Vercel origin to Render's `ROAD_RESILIENCE_CORS`. Run `npm run build` and `npm run lint` to check changes.
