/**
 * The halls OpenStreetMap has never heard of.
 *
 * Ported from assassins. Cedarville's own campus tour draws every building as
 * a polygon over a flat map image, in coordinates that mean nothing on their
 * own. It also drops sixty-odd GPS markers on that same image, each carrying a
 * real latitude and longitude. Sixty correspondences is far more than an
 * affine fit needs, so we solve for the transform once, apply it to the
 * polygons, and read off where the dorms are.
 *
 * Affine rather than anything cleverer because the map image is rotated and
 * stretched but not warped:
 *
 *   lon = a·x + b·y + c        lat = d·x + e·y + f
 *
 * Solved by normal equations over every anchor, so one bad marker cannot move
 * the answer far. What comes out is a whole outline per building rather than a
 * pin, which matters: a route anchors to the path node nearest a building's
 * edge, and the centre of a dorm is fifty metres from every door it has.
 */

const SOURCE = "https://tour.cedarville.edu/xml/CL_cedarville.xml";

export interface TourBuilding {
  title: string;
  /** Latitude, longitude pairs. */
  ring: [number, number][];
}

interface Anchor {
  x: number;
  y: number;
  lat: number;
  lon: number;
}

const pointsIn = (block: string): [number, number][] =>
  [...block.matchAll(/<item\s+y="([-\d.eE]+)"\s+x="([-\d.eE]+)"\s*\/>/g)].map((match) => [
    Number(match[2]),
    Number(match[1]),
  ]);

/** Matching key: the tour writes "St. Clair Hall" where the directory writes "St Clair Hall". */
export const tourKey = (title: string) => title.toLowerCase().replace(/[^a-z0-9]/g, "");

function fitPlane(
  samples: Anchor[],
  component: (anchor: Anchor) => number,
): [number, number, number] {
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const B = [0, 0, 0];
  for (const anchor of samples) {
    const row = [anchor.x, anchor.y, 1];
    const value = component(anchor);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) A[i]![j]! += row[i]! * row[j]!;
      B[i]! += row[i]! * value;
    }
  }
  return solve3(A as number[][], B);
}

function solve3(A: number[][], B: number[]): [number, number, number] {
  const m = A.map((row, i) => [...row, B[i]!]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    if (Math.abs(m[col]![col]!) < 1e-12) throw new Error("the tour anchors are degenerate");
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = m[r]![col]! / m[col]![col]!;
      for (let c = col; c < 4; c++) m[r]![c]! -= factor * m[col]![c]!;
    }
  }
  return [m[0]![3]! / m[0]![0]!, m[1]![3]! / m[1]![1]!, m[2]![3]! / m[2]![2]!];
}

export interface TourFit {
  buildings: Map<string, TourBuilding>;
  anchors: number;
  /** Median distance between an anchor and where the fit puts it, in metres. */
  residual: number;
}

export function parseTour(xml: string): TourFit {
  const anchors = [...xml.matchAll(/<GPS label="[^"]*">([\s\S]*?)<\/GPS>/g)]
    .map(([, body = ""]) => {
      const lat = Number(/<latitude>([-\d.]+)<\/latitude>/.exec(body)?.[1] ?? Number.NaN);
      const lon = Number(/<longitude>([-\d.]+)<\/longitude>/.exec(body)?.[1] ?? Number.NaN);
      const [point] = pointsIn(body);
      return point && Number.isFinite(lat) && Number.isFinite(lon)
        ? { x: point[0], y: point[1], lat, lon }
        : null;
    })
    .filter((anchor): anchor is Anchor => anchor !== null);

  if (anchors.length < 6) throw new Error("not enough GPS anchors in the tour to fit anything");

  const lonOf = fitPlane(anchors, (a) => a.lon);
  const latOf = fitPlane(anchors, (a) => a.lat);
  const project = ([x, y]: [number, number]) => ({
    lon: lonOf[0] * x + lonOf[1] * y + lonOf[2],
    lat: latOf[0] * x + latOf[1] * y + latOf[2],
  });

  const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const k = Math.cos((a.lat * Math.PI) / 180) * 111320;
    return Math.hypot((a.lon - b.lon) * k, (a.lat - b.lat) * 110540);
  };
  const residuals = anchors
    .map((anchor) => metres(anchor, project([anchor.x, anchor.y])))
    .sort((a, b) => a - b);

  const buildings = new Map<string, TourBuilding>();
  for (const [, body = ""] of xml.matchAll(/<POLY label="[^"]*">([\s\S]*?)<\/POLY>/g)) {
    const title = (/<title>([^<]*)<\/title>/.exec(body)?.[1] ?? "").trim();
    const ring = pointsIn(body);
    if (!title || ring.length < 3) continue;
    const key = tourKey(title);
    // Some buildings are repeated on more than one layer of the tour.
    if (buildings.has(key)) continue;
    buildings.set(key, {
      title,
      ring: ring.map(project).map((p) => [Number(p.lat.toFixed(6)), Number(p.lon.toFixed(6))]) as [
        number,
        number,
      ][],
    });
  }

  return { buildings, anchors: anchors.length, residual: residuals[residuals.length >> 1] ?? 0 };
}

export async function fetchTour(): Promise<TourFit> {
  const response = await fetch(SOURCE, {
    headers: { "user-agent": "cedarengine (github.com/taciturnaxolotl/cedarengine)" },
  });
  if (!response.ok) throw new Error(`campus tour returned HTTP ${response.status}`);
  return parseTour(await response.text());
}
