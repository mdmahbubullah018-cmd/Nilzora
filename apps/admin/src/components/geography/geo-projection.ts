/*
 * Turns the stored Bangladesh GeoJSON into SVG paths, once per page load.
 *
 * The asset is a static file under `public/geo`, so it is fetched by the browser (and
 * cached by it) only when the map mounts — never imported into a JavaScript bundle and
 * never fetched on another admin page. The projection is a simple equirectangular one
 * scaled by the cosine of the country's mid-latitude, which is accurate enough at this
 * size and keeps the shapes a single pass to compute.
 */

export interface MapShape {
  name: string;
  bn: string;
  level: 'district' | 'division';
  /** The SVG path in the projected viewBox. */
  d: string;
  /** Label anchor: the centre of the largest ring, in viewBox units. */
  cx: number;
  cy: number;
  /** Projected area, used to hide labels that would not fit. */
  area: number;
}

export interface MapGeometry {
  width: number;
  height: number;
  districts: MapShape[];
  divisions: MapShape[];
  attribution: string;
}

interface AssetFeature {
  type: 'Feature';
  properties: { name: string; bn: string; level: 'district' | 'division' };
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] };
}

export interface MapAsset {
  type: 'FeatureCollection';
  meta: { attribution: string };
  features: AssetFeature[];
}

const ASSET_URL = '/geo/bangladesh.json';
const WIDTH = 620;
const PADDING = 6;
const PRECISION = 1;

let cache: MapGeometry | null = null;
let pending: Promise<MapGeometry> | null = null;

/** The geometry, fetched at most once per page load and reused by every later mount. */
export function loadMapGeometry(): Promise<MapGeometry> {
  if (cache) return Promise.resolve(cache);
  pending ??= fetch(ASSET_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`map asset ${String(response.status)}`);
      return response.json() as Promise<MapAsset>;
    })
    .then((asset) => {
      cache = project(asset);
      return cache;
    })
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}

/** The same projection without a network round trip, for tests and server-side use. */
export function projectAsset(asset: MapAsset): MapGeometry {
  return project(asset);
}

function ringsOf(feature: AssetFeature): number[][][] {
  return feature.geometry.type === 'Polygon'
    ? feature.geometry.coordinates
    : feature.geometry.coordinates.flat();
}

function project(asset: MapAsset): MapGeometry {
  let lonMin = Infinity;
  let lonMax = -Infinity;
  let latMin = Infinity;
  let latMax = -Infinity;
  for (const feature of asset.features) {
    for (const ring of ringsOf(feature)) {
      for (const point of ring) {
        const lon = point[0] ?? 0;
        const lat = point[1] ?? 0;
        if (lon < lonMin) lonMin = lon;
        if (lon > lonMax) lonMax = lon;
        if (lat < latMin) latMin = lat;
        if (lat > latMax) latMax = lat;
      }
    }
  }

  const midLat = ((latMin + latMax) / 2) * (Math.PI / 180);
  const kx = Math.cos(midLat);
  const spanX = (lonMax - lonMin) * kx;
  const spanY = latMax - latMin;
  const scale = (WIDTH - PADDING * 2) / spanX;
  const height = spanY * scale + PADDING * 2;
  const toPoint = (lon: number, lat: number): [number, number] => [
    PADDING + (lon - lonMin) * kx * scale,
    PADDING + (latMax - lat) * scale,
  ];

  const build = (feature: AssetFeature): MapShape => {
    const polygons =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    let d = '';
    let best = { area: 0, cx: 0, cy: 0 };
    for (const polygon of polygons) {
      for (const [ringIndex, ring] of polygon.entries()) {
        let path = '';
        let signed = 0;
        let cx = 0;
        let cy = 0;
        for (let i = 0; i < ring.length; i += 1) {
          const point = ring[i];
          if (!point) continue;
          const [x, y] = toPoint(point[0] ?? 0, point[1] ?? 0);
          path += `${i === 0 ? 'M' : 'L'}${x.toFixed(PRECISION)} ${y.toFixed(PRECISION)}`;
          const next = ring[(i + 1) % ring.length] ?? point;
          const [nx, ny] = toPoint(next[0] ?? 0, next[1] ?? 0);
          signed += x * ny - nx * y;
          cx += x;
          cy += y;
        }
        d += `${path}Z`;
        if (ringIndex === 0) {
          const area = Math.abs(signed) / 2;
          if (area > best.area) {
            best = { area, cx: cx / ring.length, cy: cy / ring.length };
          }
        }
      }
    }
    return {
      name: feature.properties.name,
      bn: feature.properties.bn,
      level: feature.properties.level,
      d,
      cx: best.cx,
      cy: best.cy,
      area: best.area,
    };
  };

  const shapes = asset.features.map(build);
  return {
    width: WIDTH,
    height,
    districts: shapes.filter((shape) => shape.level === 'district'),
    divisions: shapes.filter((shape) => shape.level === 'division'),
    attribution: asset.meta.attribution,
  };
}
