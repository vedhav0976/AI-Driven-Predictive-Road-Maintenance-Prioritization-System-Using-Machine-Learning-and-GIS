import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, TileLayer } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import { AlertTriangle, Check, ExternalLink, Image, MapPin, Search } from "lucide-react";
import { apiFetch, type MapillaryImage } from "../api";
import "leaflet/dist/leaflet.css";
import "./MapillaryPicker.css";

const LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";

function captureDate(value: number | null): string {
  if (value == null) return "Capture date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Capture date unavailable" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function MapillaryImageAttribution({ image, annotated = false }: { image: MapillaryImage; annotated?: boolean }) {
  return <span className="mapillary-attribution">
    <span>Photo by {image.creator_username
      ? <a href={`https://www.mapillary.com/app/user/${encodeURIComponent(image.creator_username)}`} target="_blank" rel="noreferrer">{image.creator_username}</a>
      : "a Mapillary contributor"}</span>
    <a href={`https://www.mapillary.com/app/?pKey=${encodeURIComponent(image.id)}`} target="_blank" rel="noreferrer">Mapillary <ExternalLink size={11} /></a>
    <a href={LICENSE_URL} target="_blank" rel="noreferrer">CC BY-SA 4.0</a>
    {annotated && <span>Annotations added by Road Resilience</span>}
  </span>;
}

type Props = {
  selected: MapillaryImage[];
  onSelectionChange: (images: MapillaryImage[]) => void;
  queuedIds: string[];
  disabled: boolean;
};

export default function MapillaryPicker({ selected, onSelectionChange, queuedIds, disabled }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [images, setImages] = useState<MapillaryImage[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const selectedIds = useMemo(() => new Set(selected.map((image) => image.id)), [selected]);
  const queued = useMemo(() => new Set(queuedIds), [queuedIds]);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<{ configured: boolean }>("/api/mapillary/status", { signal: controller.signal })
      .then((status) => { setConfigured(status.configured); setStatusError(null); })
      .catch((reason: Error) => { if (!controller.signal.aborted) setStatusError(reason.message); });
    return () => controller.abort();
  }, [statusAttempt]);

  useEffect(() => () => searchAbort.current?.abort(), []);

  const toggleImage = (image: MapillaryImage) => {
    if (disabled || queued.has(image.id)) return;
    onSelectionChange(selectedIds.has(image.id) ? selected.filter((item) => item.id !== image.id) : [...selected, image]);
  };

  const searchArea = async () => {
    if (!mapRef.current || searching || disabled || !configured) return;
    const bounds = mapRef.current.getBounds();
    const west = Math.max(-180, bounds.getWest());
    const east = Math.min(180, bounds.getEast());
    const south = Math.max(-90, bounds.getSouth());
    const north = Math.min(90, bounds.getNorth());
    if (east - west > 0.1 || north - south > 0.1 || west >= east || south >= north) {
      setError("Zoom in to search a smaller road area, then choose Search this area again.");
      return;
    }
    setSearching(true);
    setError(null);
    const controller = new AbortController();
    searchAbort.current = controller;
    try {
      const params = new URLSearchParams({ bbox: [west, south, east, north].map((value) => value.toFixed(7)).join(","), limit: "24" });
      const result = await apiFetch<{ images: MapillaryImage[]; limit: number }>(`/api/mapillary/search?${params}`, { signal: controller.signal });
      setImages(result.images);
      setSearched(true);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Mapillary imagery could not be loaded. Please try again.");
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  };

  return <section className="mapillary-picker" aria-label="Choose Mapillary road images">
    <div className="mapillary-picker-heading"><div><p className="panel-kicker">STREET IMAGERY</p><h3>Explore Mapillary images</h3><p>Find road photos on the map and select the images you want to analyze.</p></div><a href="https://www.mapillary.com/" target="_blank" rel="noreferrer">About Mapillary<ExternalLink size={13} /></a></div>
    {statusError ? <div className="mapillary-state" role="alert"><AlertTriangle size={22} /><div><strong>Could not check the Mapillary connection</strong><p>{statusError}</p><button className="panel-action" type="button" onClick={() => setStatusAttempt((attempt) => attempt + 1)}>Try again</button></div></div>
      : configured == null ? <div className="mapillary-state" role="status"><span className="loading-spinner" />Checking Mapillary connection…</div>
        : !configured ? <div className="mapillary-state"><MapPin size={24} /><div><strong>Mapillary is not connected yet</strong><p>Your administrator needs to connect Mapillary before you can browse road images here. Local images and Drive uploads are still available in the source menu.</p><button className="panel-action" type="button" onClick={() => setStatusAttempt((attempt) => attempt + 1)}>Check connection</button></div></div>
          : <>
            <div className="mapillary-search-toolbar"><p>Pan and zoom to a road area. Use the + / − map controls to zoom.</p><button type="button" className="panel-action" onClick={() => void searchArea()} disabled={searching || disabled}><Search size={16} />{searching ? "Searching…" : "Search this area"}</button></div>
            <div className="mapillary-area-map"><MapContainer ref={mapRef} center={[12.9716, 77.5946]} zoom={14} minZoom={3} scrollWheelZoom={false} maxBounds={[[-85, -180], [85, 180]]} maxBoundsViscosity={1} aria-label="Pan and zoom to choose a Mapillary search area">
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {images.map((image) => <CircleMarker key={image.id} center={[image.latitude, image.longitude]} radius={selectedIds.has(image.id) ? 7 : 5} pathOptions={{ color: selectedIds.has(image.id) ? "#0b6652" : "#276b80", fillColor: selectedIds.has(image.id) ? "#16806a" : "#4b99b0", fillOpacity: 0.85, weight: 2 }} eventHandlers={{ click: () => toggleImage(image) }} />)}
            </MapContainer></div>
            {error && <p className="mapillary-search-error" role="alert"><AlertTriangle size={16} />{error}</p>}
            <div className="mapillary-selection-summary"><span>{searched ? `${images.length} image${images.length === 1 ? "" : "s"} in this search` : "Search the map to find available imagery"}</span><strong>{selected.length} selected</strong>{selected.length > 0 && <button className="panel-action" type="button" disabled={disabled} onClick={() => onSelectionChange([])}>Clear selection</button>}</div>
            {searched && images.length === 0 && !searching && <div className="mapillary-state"><Image size={26} /><div><strong>No images found in this area</strong><p>Try another road or move the map to a nearby area, then search again.</p></div></div>}
            {images.length > 0 && <div className="mapillary-image-grid" aria-label="Mapillary search results">{images.map((image) => <article className={`mapillary-image-card ${selectedIds.has(image.id) ? "selected" : ""}`} key={image.id}>
              <button className="mapillary-image-select" type="button" aria-pressed={selectedIds.has(image.id)} aria-label={`${queued.has(image.id) ? "Already queued" : selectedIds.has(image.id) ? "Deselect" : "Select"} Mapillary image ${image.id}, ${captureDate(image.captured_at)}`} disabled={disabled || queued.has(image.id)} onClick={() => toggleImage(image)}>
                <img src={image.thumbnail_url} alt={`Road scene from Mapillary, ${captureDate(image.captured_at)}`} loading="lazy" referrerPolicy="no-referrer" />
                <span className="mapillary-selection-check" aria-hidden="true">{(selectedIds.has(image.id) || queued.has(image.id)) && <Check size={15} />}</span>
                <span className="mapillary-image-details"><strong>{captureDate(image.captured_at)}</strong><span>{queued.has(image.id) ? "Already in queue" : image.is_pano ? "Panoramic image" : "Road image"}</span></span>
              </button>
              <MapillaryImageAttribution image={image} />
            </article>)}</div>}
            <p className="mapillary-capture-note">Check capture dates when reviewing road conditions. Mapillary photos may show an earlier condition than the road has today. Selected images are added using the same Add to queue button above.</p>
          </>}
  </section>;
}
