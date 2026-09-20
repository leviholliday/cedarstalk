/**
 * City, state -> lat/lon, offline.
 *
 * A directory's `city`/`state` fields are free text, and geocoding them one
 * at a time against a live API would mean a network call per person on every
 * request. Instead: the Census Bureau's own Gazetteer -- public domain, every
 * incorporated place and CDP in the country -- shipped as a flat file and
 * loaded once. See `collect/assets/us-cities.tsv` for where it came from.
 *
 * Imported as text rather than read off disk with `fs`: `bun build --compile`
 * embeds an imported asset into the binary, but a relative `readFileSync`
 * would go looking for a `src/collect/assets/` directory that doesn't exist
 * next to the compiled `dist/cedarengine` binary.
 */

import usCitiesTsv from "../collect/assets/us-cities.tsv" with { type: "text" };

export interface CityLocation {
  city: string;
  state: string;
  lat: number;
  lon: number;
}

/**
 * A directory writes "Winston Salem"; the Gazetteer writes "Winston-Salem".
 * Folding punctuation away makes those the same string, which is the only
 * reason "Land O Lakes" ever finds "Land O' Lakes".
 */
const normalize = (city: string): string =>
  city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** What's left of a consolidated government's name once the asset stripped the trailing "government". */
const GOVERNMENT_FORM = /\s+(urban|metro|metropolitan|consolidated|unified)(\s+county)?$/i;
/** Only ever stripped from a "(balance)" row, where it was left dangling mid-name. */
const TRAILING_TYPE = /\s+(city|town|village|borough|township|municipality)$/i;

/**
 * The plain name a person would actually write for one Gazetteer row.
 *
 * Consolidated city-counties are why this exists. The Census files
 * "Indianapolis city (balance)", "Louisville/Jefferson County metro
 * government", "Nashville-Davidson metropolitan government" -- and a student
 * from any of them writes "Indianapolis", "Louisville", "Nashville". Left
 * alone that silently drops some of the largest feeder cities in the region;
 * Indianapolis alone is 81 people here.
 *
 * Returns the row's own name first, then any fallback worth registering only
 * if nothing better claims it. The two are kept apart deliberately: stripping
 * eagerly is how "Plain City" and "Grove City" quietly became "Plain" and
 * "Grove" the first time this was written.
 */
function aliasesOf(city: string): { primary: string; fallback: string | null } {
  const balanced = /\(balance\)/i.test(city);
  let name = city.replace(/\(balance\)/gi, " ").trim();
  name = name.replace(GOVERNMENT_FORM, "");
  // Only a "(balance)" row ends in a bare place type that isn't part of the
  // name. "White City metro" keeps its City; "Indianapolis city (balance)"
  // does not.
  if (balanced) name = name.replace(TRAILING_TYPE, "");

  const primary = normalize(name);
  // A government form spanning two places names the city first:
  // "Athens-Clarke County" is Athens, "Lynchburg, Moore County" is Lynchburg.
  const compound = balanced || GOVERNMENT_FORM.test(city) || /government/i.test(city);
  const lead = compound ? normalize(name.split(/[-/,]/)[0] ?? "") : "";

  return { primary, fallback: lead && lead !== primary ? lead : null };
}

let cache: Map<string, CityLocation> | undefined;

function load(): Map<string, CityLocation> {
  if (cache) return cache;
  const map = new Map<string, CityLocation>();
  const fallbacks: [string, CityLocation][] = [];

  for (const line of usCitiesTsv.split("\n")) {
    if (!line || line.startsWith("#") || line.startsWith("state\t")) continue;
    const [state, city, lat, lon] = line.split("\t");
    if (!state || !city || !lat || !lon) continue;
    const place = { city, state, lat: Number(lat), lon: Number(lon) };
    const { primary, fallback } = aliasesOf(city);

    const key = `${state.toUpperCase()}|${primary}`;
    // First one wins on a rare duplicate (a town and a CDP sharing a
    // stripped name) -- close enough for carpool-radius purposes either way.
    if (primary && !map.has(key)) map.set(key, place);
    if (fallback) fallbacks.push([`${state.toUpperCase()}|${fallback}`, place]);
  }

  // Derived names go in last, so a real place called Athens always beats the
  // "Athens" pulled out of Athens-Clarke County.
  for (const [key, place] of fallbacks) if (!map.has(key)) map.set(key, place);

  cache = map;
  return map;
}

/** Null when the city doesn't match anything in the Gazetteer -- a typo, an abbreviation, or somewhere outside the US. */
export function geocode(city: string, state: string): CityLocation | null {
  return load().get(`${state.toUpperCase()}|${normalize(city)}`) ?? null;
}
