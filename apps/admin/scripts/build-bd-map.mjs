/*
 * Builds the admin's Bangladesh map asset from the geoBoundaries gbOpen release.
 * A command-line build step, so it reports through the console.
 *
 * Source: geoBoundaries BGD ADM1/ADM2, release 9469f09, simplified geometry.
 *   https://www.geoboundaries.org/api/current/gbOpen/BGD/ADM2/
 * Licence: CC BY 3.0 IGO — attribution: "Boundaries: geoBoundaries (gbOpen),
 *   source Bangladesh Bureau of Statistics (BBS) and OCHA ROAP."
 * The asset keeps that attribution in its `meta` block; do not remove it.
 *
 * The output is a plain GeoJSON FeatureCollection the map fetches at runtime, with
 * every property that is not needed for drawing or labelling removed, coordinates
 * rounded, rings simplified with Douglas-Peucker and tiny slivers dropped.
 *
 * Usage: node scripts/build-bd-map.mjs <adm2.json> <adm1.json> <out.json>
 */
/* eslint-disable no-console */
import { readFileSync, writeFileSync } from 'node:fs';

/* geoBoundaries spells nine districts the old way; the database's bd_districts uses
 * the current official name, so the map is keyed by the database's spelling. Anything
 * not listed here must match exactly, and the build fails if a district is left over. */
const ALIASES = {
  Barisal: 'Barishal',
  Bogra: 'Bogura',
  Brahamanbaria: 'Brahmanbaria',
  Chittagong: 'Chattogram',
  Comilla: 'Cumilla',
  Jessore: 'Jashore',
  Maulvibazar: 'Moulvibazar',
  Nawabganj: 'Chapai Nawabganj',
  Netrakona: 'Netrokona',
};

const DIVISION_ALIASES = { Chittagong: 'Chattogram', Rajshani: 'Rajshahi', Barisal: 'Barishal' };

const BN_DISTRICT = {
  Bagerhat: 'বাগেরহাট', Bandarban: 'বান্দরবান', Barguna: 'বরগুনা', Barishal: 'বরিশাল',
  Bhola: 'ভোলা', Bogura: 'বগুড়া', Brahmanbaria: 'ব্রাহ্মণবাড়িয়া', Chandpur: 'চাঁদপুর',
  Chattogram: 'চট্টগ্রাম', 'Chapai Nawabganj': 'চাঁপাইনবাবগঞ্জ', Chuadanga: 'চুয়াডাঙ্গা',
  CoxsBazar: 'কক্সবাজার', Cumilla: 'কুমিল্লা', Dhaka: 'ঢাকা', Dinajpur: 'দিনাজপুর',
  Faridpur: 'ফরিদপুর', Feni: 'ফেনী', Gaibandha: 'গাইবান্ধা', Gazipur: 'গাজীপুর',
  Gopalganj: 'গোপালগঞ্জ', Habiganj: 'হবিগঞ্জ', Jamalpur: 'জামালপুর', Jashore: 'যশোর',
  Jhalokati: 'ঝালকাঠি', Jhenaidah: 'ঝিনাইদহ', Joypurhat: 'জয়পুরহাট', Khagrachhari: 'খাগড়াছড়ি',
  Khulna: 'খুলনা', Kishoreganj: 'কিশোরগঞ্জ', Kurigram: 'কুড়িগ্রাম', Kushtia: 'কুষ্টিয়া',
  Lakshmipur: 'লক্ষ্মীপুর', Lalmonirhat: 'লালমনিরহাট', Madaripur: 'মাদারীপুর', Magura: 'মাগুরা',
  Manikganj: 'মানিকগঞ্জ', Meherpur: 'মেহেরপুর', Moulvibazar: 'মৌলভীবাজার', Munshiganj: 'মুন্সিগঞ্জ',
  Mymensingh: 'ময়মনসিংহ', Naogaon: 'নওগাঁ', Narail: 'নড়াইল', Narayanganj: 'নারায়ণগঞ্জ',
  Narsingdi: 'নরসিংদী', Natore: 'নাটোর', Netrokona: 'নেত্রকোণা', Nilphamari: 'নীলফামারী',
  Noakhali: 'নোয়াখালী', Pabna: 'পাবনা', Panchagarh: 'পঞ্চগড়', Patuakhali: 'পটুয়াখালী',
  Pirojpur: 'পিরোজপুর', Rajbari: 'রাজবাড়ী', Rajshahi: 'রাজশাহী', Rangamati: 'রাঙ্গামাটি',
  Rangpur: 'রংপুর', Satkhira: 'সাতক্ষীরা', Shariatpur: 'শরীয়তপুর', Sherpur: 'শেরপুর',
  Sirajganj: 'সিরাজগঞ্জ', Sunamganj: 'সুনামগঞ্জ', Sylhet: 'সিলেট', Tangail: 'টাঙ্গাইল',
  Thakurgaon: 'ঠাকুরগাঁও',
};

const BN_DIVISION = {
  Barishal: 'বরিশাল', Chattogram: 'চট্টগ্রাম', Dhaka: 'ঢাকা', Khulna: 'খুলনা',
  Mymensingh: 'ময়মনসিংহ', Rajshahi: 'রাজশাহী', Rangpur: 'রংপুর', Sylhet: 'সিলেট',
};

const [, , adm2Path, adm1Path, outPath] = process.argv;

/* Tuning knobs, so the asset can be regenerated smaller or sharper without editing code. */
const DISTRICT_TOLERANCE = Number(process.env.BD_TOL ?? 0.0035);
const DIVISION_TOLERANCE = Number(process.env.BD_DIV_TOL ?? 0.006);
const DIGITS = Number(process.env.BD_DIGITS ?? 4);

/** Squared distance from a point to a segment, for Douglas-Peucker. */
function segmentDistanceSq([px, py], [ax, ay], [bx, by]) {
  let x = ax;
  let y = ay;
  let dx = bx - x;
  let dy = by - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = bx;
      y = by;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}

function simplify(points, tolerance) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const tolSq = tolerance * tolerance;
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let index = -1;
    let maxDist = tolSq;
    for (let i = first + 1; i < last; i += 1) {
      const d = segmentDistanceSq(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Twice the signed area: used only to drop slivers too small to colour. */
function area(points) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    sum += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(sum / 2);
}

const round = (n, digits) => Math.round(n * 10 ** digits) / 10 ** digits;

function ring(points, tolerance, digits, minArea) {
  const closed =
    points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1]
      ? points
      : [...points, points[0]];
  if (area(closed) < minArea) return null;
  const simplified = simplify(closed, tolerance).map(([x, y]) => [round(x, digits), round(y, digits)]);
  return simplified.length >= 4 ? simplified : null;
}

function polygons(geometry, tolerance, digits, minArea) {
  const rings = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const built = rings
    .map((polygon) =>
      polygon
        .map((r, i) => ring(r, i === 0 ? tolerance : tolerance / 2, digits, i === 0 ? minArea : 0))
        .filter((r) => r !== null),
    )
    .filter((polygon) => polygon.length > 0);
  if (built.length === 0) return null;
  return built.length === 1
    ? { type: 'Polygon', coordinates: built[0] }
    : { type: 'MultiPolygon', coordinates: built };
}

const adm2 = JSON.parse(readFileSync(adm2Path, 'utf8'));
const adm1 = JSON.parse(readFileSync(adm1Path, 'utf8'));

const districts = [];
const seen = new Set();
for (const feature of adm2.features) {
  const raw = feature.properties.shapeName;
  const name = ALIASES[raw] ?? raw;
  if (seen.has(name)) throw new Error(`duplicate district after aliasing: ${name}`);
  seen.add(name);
  const key = name === "Cox's Bazar" ? 'CoxsBazar' : name;
  const bn = BN_DISTRICT[key];
  if (!bn) throw new Error(`missing Bengali name for ${name}`);
  const geometry = polygons(feature.geometry, DISTRICT_TOLERANCE, DIGITS, 0.00002);
  if (!geometry) throw new Error(`district vanished while simplifying: ${name}`);
  districts.push({ properties: { name, bn }, geometry });
}

const divisions = [];
for (const feature of adm1.features) {
  const name = DIVISION_ALIASES[feature.properties.shapeName] ?? feature.properties.shapeName;
  const bn = BN_DIVISION[name];
  if (!bn) throw new Error(`missing Bengali name for division ${name}`);
  const geometry = polygons(feature.geometry, DIVISION_TOLERANCE, DIGITS, 0.0005);
  if (!geometry) throw new Error(`division vanished while simplifying: ${name}`);
  divisions.push({ properties: { name, bn }, geometry });
}

const out = {
  type: 'FeatureCollection',
  meta: {
    licence: 'CC BY 3.0 IGO',
    attribution:
      'Boundaries: geoBoundaries (gbOpen) — Bangladesh Bureau of Statistics (BBS), OCHA ROAP',
    source: 'https://www.geoboundaries.org/api/current/gbOpen/BGD/ADM2/',
    divisions: divisions.length,
    districts: districts.length,
  },
  features: [
    ...divisions.map((d) => ({
      type: 'Feature',
      properties: { ...d.properties, level: 'division' },
      geometry: d.geometry,
    })),
    ...districts.map((d) => ({
      type: 'Feature',
      properties: { ...d.properties, level: 'district' },
      geometry: d.geometry,
    })),
  ],
};

const json = JSON.stringify(out);
writeFileSync(outPath, json);
console.log(`districts=${districts.length} divisions=${divisions.length}`);
console.log(`kb=${(json.length / 1024).toFixed(0)}`);
