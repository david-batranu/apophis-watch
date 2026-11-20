import { describe, expect, it } from 'vitest';
import {
  TERRARIUM_BASE_URL,
  decodeTerrarium,
  encodeTerrarium,
  terrariumTileUrl,
} from '../../src/terrain/terrarium';

describe('AWS Terrarium decoding', () => {
  it('decodes the documented R*256 + G + B/256 - 32768 formula', () => {
    const rgba = new Uint8ClampedArray([
      128, 0, 0, 255, // 0 m
      128, 1, 128, 255, // 1.5 m
      127, 255, 0, 255, // -1 m
      200, 0, 0, 255, // 18,432 m
    ]);
    const elevations = decodeTerrarium(rgba, 2, 2);
    expect(Array.from(elevations)).toEqual([0, 1.5, -1, 18_432]);
  });

  it('round-trips sub-metre elevations through the RGBA quantisation', () => {
    const source = [0, 1.5, -1, 100.25, 612.5, 8_848, -430];
    const encoded = encodeTerrarium(source, source.length, 1);
    const decoded = decodeTerrarium(encoded, source.length, 1);
    for (let i = 0; i < source.length; i++) {
      expect(decoded[i]).toBeCloseTo(source[i], 2);
      expect(Math.abs(decoded[i] - source[i])).toBeLessThanOrEqual(1 / 256);
    }
  });

  it('encodes zero as the canonical sea-level RGB value', () => {
    const encoded = encodeTerrarium([0], 1, 1);
    expect(Array.from(encoded)).toEqual([128, 0, 0, 255]);
  });

  it('rejects buffers with the wrong size', () => {
    expect(() => decodeTerrarium(new Uint8ClampedArray(15), 2, 2)).toThrow(
      /expected 16/,
    );
    expect(() => encodeTerrarium([1, 2], 2, 2)).toThrow(/expected 4/);
  });

  it('builds the confirmed AWS URL and attribution', () => {
    expect(terrariumTileUrl(14, 9353, 5848)).toBe(
      `${TERRARIUM_BASE_URL}/14/9353/5848.png`,
    );
    expect(TERRARIUM_BASE_URL).toBe(
      'https://elevation-tiles-prod.s3.amazonaws.com/terrarium',
    );
  });
});
