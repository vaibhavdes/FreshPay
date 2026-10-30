import { describe, expect, it } from 'vitest';
import { centroid, closeRing, distanceToRingMeters, pointInRing, ringAreaHectares, withinPlot, type LngLat } from '@/lib/engine/geo';

// About 216 m x 222 m near Chikkamagaluru, closed the GeoJSON way.
const plot: LngLat[] = [
  [75.77, 13.32],
  [75.772, 13.32],
  [75.772, 13.322],
  [75.77, 13.322],
  [75.77, 13.32],
];

describe('geo', () => {
  it('finds a point inside the plot', () => {
    expect(pointInRing([75.771, 13.321], plot)).toBe(true);
    expect(withinPlot([75.771, 13.321], plot, 0)).toBe(true);
  });

  it('measures the distance from a point outside the plot', () => {
    const north = [75.771, 13.3225] as const;
    expect(pointInRing(north, plot)).toBe(false);
    expect(distanceToRingMeters(north, plot)).toBeCloseTo(55.6, 0);
  });

  it('accepts GPS drift inside the buffer and rejects it outside', () => {
    const north = [75.771, 13.3225] as const;
    expect(withinPlot(north, plot, 100)).toBe(true);
    expect(withinPlot(north, plot, 10)).toBe(false);
    expect(withinPlot([75.78, 13.33], plot, 100)).toBe(false);
  });

  it('works on an open ring', () => {
    expect(withinPlot([75.771, 13.321], plot.slice(0, 4), 0)).toBe(true);
  });

  it('rejects a degenerate ring', () => {
    expect(() => withinPlot([75.771, 13.321], plot.slice(0, 2), 100)).toThrow(RangeError);
  });
});

describe('plot measurements', () => {
  it('measures the plot area in hectares', () => {
    expect(ringAreaHectares(plot)).toBeCloseTo(4.81, 2);
    expect(ringAreaHectares(plot.slice(0, 4))).toBeCloseTo(4.81, 2);
  });

  it('finds the centre and closes open rings', () => {
    const [lng, lat] = centroid(plot);
    expect(lng).toBeCloseTo(75.771, 9);
    expect(lat).toBeCloseTo(13.321, 9);
    expect(closeRing(plot.slice(0, 4))).toEqual(plot);
    expect(closeRing(plot)).toEqual(plot);
  });
});
