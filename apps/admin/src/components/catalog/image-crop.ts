/*
 * Crop geometry for the image crop dialog, kept free of the DOM so it is unit-tested.
 * Every rectangle is in the picture's own pixels.
 */

export const CROP_PRESETS = [
  { key: 'original', label: 'Original', aspect: null },
  { key: 'square', label: '1:1', aspect: 1 },
  { key: 'portrait', label: '4:5', aspect: 4 / 5 },
] as const;

export type CropPreset = (typeof CROP_PRESETS)[number]['key'];

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

/** The largest rectangle of `aspect` (width / height) inside the picture, shrunk by `zoom`. */
export function cropSize(
  imageWidth: number,
  imageHeight: number,
  aspect: number | null,
  zoom = 1,
): { width: number; height: number } {
  const scale = 1 / Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  if (aspect === null) {
    return { width: Math.round(imageWidth * scale), height: Math.round(imageHeight * scale) };
  }
  let width = imageWidth;
  let height = imageWidth / aspect;
  if (height > imageHeight) {
    height = imageHeight;
    width = imageHeight * aspect;
  }
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Keeps a rectangle inside the picture. */
export function clampRect(rect: CropRect, imageWidth: number, imageHeight: number): CropRect {
  const width = Math.min(rect.width, imageWidth);
  const height = Math.min(rect.height, imageHeight);
  return {
    width,
    height,
    x: Math.round(Math.min(Math.max(0, rect.x), imageWidth - width)),
    y: Math.round(Math.min(Math.max(0, rect.y), imageHeight - height)),
  };
}

/**
 * The crop rectangle for a preset and zoom, centred on `center` (picture pixels; the
 * picture's middle by default) and kept inside the picture.
 */
export function cropRect(
  imageWidth: number,
  imageHeight: number,
  aspect: number | null,
  zoom = 1,
  center: { x: number; y: number } = { x: imageWidth / 2, y: imageHeight / 2 },
): CropRect {
  const { width, height } = cropSize(imageWidth, imageHeight, aspect, zoom);
  return clampRect(
    { x: center.x - width / 2, y: center.y - height / 2, width, height },
    imageWidth,
    imageHeight,
  );
}

/** Moves a rectangle by a distance, staying inside the picture. */
export function moveRect(
  rect: CropRect,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, imageWidth, imageHeight);
}

/** The output type for a cropped picture: the original's type when the API takes it. */
export function cropOutputType(type: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  return type === 'image/png' || type === 'image/webp' ? type : 'image/jpeg';
}

/** "photo.jpg" → "photo-crop.jpg", with the extension of the output type. */
export function croppedName(name: string, type: string): string {
  const base = name.replace(/\.[^.]*$/, '') || 'image';
  const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return `${base}-crop.${extension}`;
}
