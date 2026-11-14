const VERCEL_REQUEST_BUDGET = 3.5 * 1024 * 1024;

export type ImageGps = { latitude: number; longitude: number };
export type PreparedImage = { file: File; gps: ImageGps | null; resized: boolean };

function readExifGps(bytes: DataView, start: number, end: number): ImageGps | null {
  const read16 = (offset: number, little: boolean) => bytes.getUint16(offset, little);
  const read32 = (offset: number, little: boolean) => bytes.getUint32(offset, little);
  const rational = (offset: number, little: boolean) => {
    const numerator = read32(offset, little);
    const denominator = read32(offset + 4, little);
    return denominator ? numerator / denominator : NaN;
  };

  // Walk JPEG markers until the EXIF APP1 segment, then follow the TIFF GPS IFD.
  let cursor = start;
  while (cursor + 4 <= end) {
    if (bytes.getUint8(cursor) !== 0xff) return null;
    const marker = bytes.getUint8(cursor + 1);
    cursor += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    const segmentLength = read16(cursor, false);
    const segmentStart = cursor + 2;
    const segmentEnd = cursor + segmentLength;
    if (segmentLength < 2 || segmentEnd > end) return null;
    if (marker === 0xe1 && segmentEnd - segmentStart >= 14 &&
        bytes.getUint32(segmentStart, false) === 0x45786966 &&
        bytes.getUint16(segmentStart + 4, false) === 0) {
      const tiff = segmentStart + 6;
      const byteOrder = bytes.getUint16(tiff, false);
      const little = byteOrder === 0x4949;
      if (!little && byteOrder !== 0x4d4d) return null;
      if (read16(tiff + 2, little) !== 42) return null;
      const ifd0 = tiff + read32(tiff + 4, little);
      if (ifd0 + 2 > segmentEnd) return null;
      const count = read16(ifd0, little);
      let gpsIfd = 0;
      for (let index = 0; index < count; index += 1) {
        const entry = ifd0 + 2 + index * 12;
        if (entry + 12 > segmentEnd) return null;
        if (read16(entry, little) === 0x8825) gpsIfd = tiff + read32(entry + 8, little);
      }
      if (!gpsIfd || gpsIfd + 2 > segmentEnd) return null;
      const gpsCount = read16(gpsIfd, little);
      let latRef = "N";
      let lonRef = "E";
      let latValues: number[] | null = null;
      let lonValues: number[] | null = null;
      for (let index = 0; index < gpsCount; index += 1) {
        const entry = gpsIfd + 2 + index * 12;
        if (entry + 12 > segmentEnd) return null;
        const tag = read16(entry, little);
        const type = read16(entry + 2, little);
        const amount = read32(entry + 4, little);
        const valueOffset = amount <= 4 ? entry + 8 : tiff + read32(entry + 8, little);
        if (tag === 1 || tag === 3) {
          const ref = String.fromCharCode(bytes.getUint8(valueOffset));
          if (tag === 1) latRef = ref.toUpperCase(); else lonRef = ref.toUpperCase();
        } else if ((tag === 2 || tag === 4) && type === 5 && amount === 3) {
          if (valueOffset + 24 > segmentEnd) return null;
          const values = [0, 1, 2].map((part) => rational(valueOffset + part * 8, little));
          if (tag === 2) latValues = values; else lonValues = values;
        }
      }
      if (!latValues || !lonValues) return null;
      const toDecimal = (values: number[], negative: string, ref: string) => {
        const value = values[0] + values[1] / 60 + values[2] / 3600;
        return ref === negative ? -value : value;
      };
      const latitude = toDecimal(latValues, "S", latRef);
      const longitude = toDecimal(lonValues, "W", lonRef);
      if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && (latitude !== 0 || longitude !== 0)) {
        return { latitude, longitude };
      }
      return null;
    }
    cursor = segmentEnd;
  }
  return null;
}

async function extractGps(file: File): Promise<ImageGps | null> {
  if (file.type !== "image/jpeg" && !/\.jpe?g$/i.test(file.name)) return null;
  try {
    const bytes = new DataView(await file.arrayBuffer());
    if (bytes.byteLength < 4 || bytes.getUint16(0, false) !== 0xffd8) return null;
    return readExifGps(bytes, 2, bytes.byteLength);
  } catch {
    return null;
  }
}

export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  const gps = await extractGps(file);
  if (file.size <= VERCEL_REQUEST_BUDGET) return { file, gps, resized: false };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`${file.name} is too large for Vercel and could not be resized in this browser. Save it as JPEG or PNG and try again.`);
  }
  try {
    const canvas = document.createElement("canvas");
    let scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 8; attempt += 1) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("This browser could not prepare the image for upload.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", Math.max(0.62, 0.88 - attempt * 0.04)));
      if (blob && blob.size <= VERCEL_REQUEST_BUDGET) {
        return { file: new File([blob], file.name, { type: "image/jpeg", lastModified: file.lastModified }), gps, resized: true };
      }
      scale *= 0.78;
    }
    throw new Error(`${file.name} could not be reduced enough to upload. Try a smaller image.`);
  } finally {
    bitmap.close();
  }
}

export function appendGps(form: FormData, gps: ImageGps | null) {
  if (!gps) return;
  form.append("exif_latitude", String(gps.latitude));
  form.append("exif_longitude", String(gps.longitude));
}
