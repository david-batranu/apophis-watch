import { describe, expect, it } from 'vitest';
import {
  buildOverpassQuery,
  buildingHeightFromTags,
  defaultHeightShare,
  parseHeightMeters,
  parseLevels,
  parseOverpassBuildings,
  type OverpassResponse,
} from '../../src/terrain/buildings';

describe('building height priority', () => {
  it('uses building:height before height', () => {
    const info = buildingHeightFromTags({
      'building:height': '12.5',
      height: '20',
      'building:levels': '4',
    });
    expect(info.heightM).toBe(12.5);
    expect(info.heightSource).toBe('building:height');
    expect(info.levels).toBe(4);
  });

  it('falls through to height, then levels*3, then the 8 m default', () => {
    expect(buildingHeightFromTags({ height: '20', 'building:levels': '4' })).toEqual({
      heightM: 20,
      heightSource: 'height',
      levels: 4,
    });
    expect(buildingHeightFromTags({ 'building:levels': '4' })).toEqual({
      heightM: 12,
      heightSource: 'levels',
      levels: 4,
    });
    expect(buildingHeightFromTags({})).toEqual({
      heightM: 8,
      heightSource: 'default',
      levels: null,
    });
  });

  it('falls through invalid higher-priority values', () => {
    expect(
      buildingHeightFromTags({ 'building:height': 'tall', height: '15' }).heightSource,
    ).toBe('height');
    expect(
      buildingHeightFromTags({ height: '0', 'building:levels': '2' }).heightSource,
    ).toBe('levels');
    expect(
      buildingHeightFromTags({ 'building:levels': 'many' }).heightSource,
    ).toBe('default');
  });

  it('parses metres, feet and levels', () => {
    expect(parseHeightMeters('12')).toBe(12);
    expect(parseHeightMeters('12.5 m')).toBe(12.5);
    expect(parseHeightMeters('40 ft')).toBeCloseTo(12.192, 3);
    expect(parseHeightMeters("30'")).toBeCloseTo(9.144, 3);
    expect(parseHeightMeters('12,5')).toBe(12.5);
    expect(parseHeightMeters('')).toBeNull();
    expect(parseHeightMeters('-3')).toBeNull();
    expect(parseLevels('4')).toBe(4);
    expect(parseLevels('4;5')).toBe(4);
    expect(parseLevels('4.5')).toBe(4.5);
    expect(parseLevels('n/a')).toBeNull();
  });
});

describe('Overpass response parsing', () => {
  const response: OverpassResponse = {
    version: 0.6,
    osm3s: { timestamp_osm_base: '2026-11-20T10:00:00Z' },
    elements: [
      {
        type: 'way',
        id: 101,
        tags: { building: 'house', 'building:height': '12' },
        geometry: [
          { lat: 45, lon: 25 },
          { lat: 45, lon: 25.0001 },
          { lat: 45.0001, lon: 25.0001 },
          { lat: 45.0001, lon: 25 },
          { lat: 45, lon: 25 },
        ],
      },
      {
        type: 'way',
        id: 102,
        tags: { building: 'yes', height: '20' },
        geometry: [
          { lat: 45, lon: 25 },
          { lat: 45, lon: 25.0001 },
          { lat: 45.0001, lon: 25.0001 },
        ],
      },
      {
        type: 'way',
        id: 103,
        tags: { building: 'yes', 'building:levels': '4' },
        geometry: [
          { lat: 45, lon: 25 },
          { lat: 45, lon: 25.0001 },
          { lat: 45.0001, lon: 25.0001 },
        ],
      },
      {
        type: 'way',
        id: 104,
        tags: { building: 'shed' },
        geometry: [
          { lat: 45, lon: 25 },
          { lat: 45, lon: 25.0001 },
          { lat: 45.0001, lon: 25.0001 },
        ],
      },
      {
        type: 'node',
        id: 1,
        tags: { building: 'no' },
        geometry: [],
      },
      {
        type: 'way',
        id: 105,
        tags: { highway: 'residential' },
        geometry: [
          { lat: 45, lon: 25 },
          { lat: 45, lon: 25.0001 },
        ],
      },
      {
        type: 'way',
        id: 106,
        tags: { building: ' NO ', height: '20' },
        geometry: [
          { lat: 45, lon: 25 },
          { lat: 45, lon: 25.0001 },
          { lat: 45.0001, lon: 25.0001 },
        ],
      },
      {
        type: 'way',
        id: 107,
        tags: { building: ' House ' },
        geometry: [
          { lat: 45, lon: 25 },
          { lat: 45, lon: 25.0001 },
          { lat: 45.0001, lon: 25.0001 },
        ],
      },
    ],
  };

  it('keeps building ways, removes the repeated closing point and counts defaults', () => {
    const result = parseOverpassBuildings(response, 45, 25, 1_000);
    expect(result.buildings).toHaveLength(5);
    expect(result.buildings.map((building) => building.id)).not.toContain(106);
    expect(result.buildings.map((building) => building.id)).toContain(107);
    expect(result.buildings[0].ring).toHaveLength(4);
    expect(result.buildings[0].heightM).toBe(12);
    expect(result.buildings[0].heightSource).toBe('building:height');
    expect(result.buildings[1].heightM).toBe(20);
    expect(result.buildings[2].heightM).toBe(12);
    expect(result.buildings[2].heightSource).toBe('levels');
    expect(result.buildings[3].heightM).toBe(8);
    expect(result.buildings[3].heightSource).toBe('default');
    expect(result.defaultHeightCount).toBe(2);
    expect(result.taggedHeightCount).toBe(3);
    expect(defaultHeightShare(result)).toBeCloseTo(0.4, 6);
    expect(result.osmTimestamp).toBe('2026-11-20T10:00:00Z');
  });

  it('rejects a response without elements', () => {
    expect(() => parseOverpassBuildings({}, 45, 25, 1_000)).toThrow(
      /elements/,
    );
  });

  it('produces the exact policy query', () => {
    expect(buildOverpassQuery(45.6427, 25.5887, 1_000)).toBe(
      '[out:json][timeout:25];way["building"](around:1000,45.642700,25.588700);out geom;',
    );
    expect(buildOverpassQuery(45, 25, 99_999)).toContain('around:5000,');
  });
});
