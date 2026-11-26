/**
 * The crop maths for the mobile crop step, kept pure so it can be unit-tested without a screen.
 *
 * The picture is shown "cover" inside a square frame: it fills the frame and the parts that
 * fall outside are cropped away. Panning moves it, pinching scales it, and the frame itself is
 * the crop window — the same model as the website. Given the gesture state, this turns the
 * frame back into a rectangle of the *original* picture for expo-image-manipulator.
 */

export interface CropGesture {
  /** 1 = the picture exactly covers the frame; larger zooms in. */
  scale: number;
  /** Translation in frame pixels, as the gesture produced it. */
  translateX: number;
  translateY: number;
}

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export function cropRect(
  image: { width: number; height: number },
  frameSize: number,
  gesture: CropGesture,
): CropRect {
  if (image.width <= 0 || image.height <= 0 || frameSize <= 0) {
    return { originX: 0, originY: 0, width: 1, height: 1 };
  }
  const scale = Math.max(1, gesture.scale);
  // The scale at which the picture covers the frame at 1x.
  const cover = Math.max(frameSize / image.width, frameSize / image.height);
  const effective = cover * scale;
  const side = Math.min(image.width, image.height, frameSize / effective);
  const centerX = image.width / 2 - gesture.translateX / effective;
  const centerY = image.height / 2 - gesture.translateY / effective;

  const originX = clamp(centerX - side / 2, 0, Math.max(0, image.width - side));
  const originY = clamp(centerY - side / 2, 0, Math.max(0, image.height - side));
  return {
    originX: Math.round(originX),
    originY: Math.round(originY),
    width: Math.round(side),
    height: Math.round(side),
  };
}

/** The size to store: never wider than 1024, never upscaled. */
export function outputSize(rect: CropRect, max = 1024): { width: number; height: number } {
  const longest = Math.max(rect.width, rect.height);
  if (longest <= max) return { width: rect.width, height: rect.height };
  const ratio = max / longest;
  return { width: Math.round(rect.width * ratio), height: Math.round(rect.height * ratio) };
}

/** Keeps a pan inside the picture instead of letting it drift into empty space. */
export function clampPan(
  translate: number,
  imageSize: number,
  frameSize: number,
  scale: number,
): number {
  const cover = Math.max(frameSize / imageSize, 0);
  const effective = cover * Math.max(1, scale);
  const overflow = Math.max(0, imageSize * effective - frameSize) / 2;
  return clamp(translate, -overflow, overflow);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
