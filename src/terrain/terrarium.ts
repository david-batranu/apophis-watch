/**
 * AWS Terrarium PNG encoding.
 *
 * elevation_m = (R * 256 + G + B / 256) - 32768
 *
 * Tiles are 256×256 RGB PNGs, maximum zoom 15, served with CORS * from
 * https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png
 */

export const TERRARIUM_BASE_URL =
  'https://elevation-tiles-prod.s3.amazonaws.com/terrarium';
export const TERRARIUM_TILE_SIZE = 256;
export const TERRARIUM_ATTRIBUTION =
  'Terrain Tiles by Mapzen / AWS Open Data';

export function terrariumTileUrl(z: number, x: number, y: number): string {
  return `${TERRARIUM_BASE_URL}/${z}/${x}/${y}.png`;
}

/**
 * Decode RGBA pixel data into elevations in metres. Alpha is ignored; the
 * AWS tiles are RGB. Throws if the buffer is not exactly width*height*4.
 */
export function decodeTerrarium(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Float32Array {
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `terrarium buffer is ${rgba.length} bytes, expected ${width * height * 4}`,
    );
  }
  const out = new Float32Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = rgba[j] * 256 + rgba[j + 1] + rgba[j + 2] / 256 - 32768;
  }
  return out;
}

/**
 * Encode elevations as RGBA, for tests and for synthetic fixtures. Values are
 * quantised to 1/256 m, matching the source format.
 */
export function encodeTerrarium(
  elevations: ArrayLike<number>,
  width: number,
  height: number,
): Uint8ClampedArray {
  if (elevations.length !== width * height) {
    throw new Error(
      `elevation count is ${elevations.length}, expected ${width * height}`,
    );
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < elevations.length; i++, j += 4) {
    const scaled = Math.round((elevations[i] + 32768) * 256);
    const clamped = Math.max(0, Math.min(0xffffff, scaled));
    rgba[j] = Math.floor(clamped / 65536) & 0xff;
    rgba[j + 1] = Math.floor(clamped / 256) & 0xff;
    rgba[j + 2] = clamped & 0xff;
    rgba[j + 3] = 255;
  }
  return rgba;
}

/**
 * Browser-side PNG decode. Prefers createImageBitmap + OffscreenCanvas and
 * falls back to an HTMLCanvasElement for older iOS Safari.
 */
export async function decodeTerrariumPng(blob: Blob): Promise<Float32Array> {
  const bitmap = await createImageBitmap(blob);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    let data: Uint8ClampedArray;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D canvas unavailable for terrarium decode');
      ctx.drawImage(bitmap, 0, 0);
      data = ctx.getImageData(0, 0, width, height).data;
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D canvas unavailable for terrarium decode');
      ctx.drawImage(bitmap, 0, 0);
      data = ctx.getImageData(0, 0, width, height).data;
    }
    return decodeTerrarium(data, width, height);
  } finally {
    bitmap.close?.();
  }
}
