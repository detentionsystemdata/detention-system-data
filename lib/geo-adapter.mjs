// County-reference lookups: ZIP → county FIPS and place → county FIPS, from baked
// public-domain crosswalks (Census county list, HUD-USPS ZIP–county, Census place-county).
// Point COUNTY_GEO_DATA at a directory containing counties.json, zip-to-county.json, and
// place-to-county.json; defaults to ./geo-data (a local, untracked path).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GEO = process.env.COUNTY_GEO_DATA ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../geo-data");

const read = (f) => JSON.parse(fs.readFileSync(path.join(GEO, f), "utf8"));

let counties, zip2county, place2county;
try {
  counties = read("counties.json");
  zip2county = read("zip-to-county.json");
  place2county = read("place-to-county.json");
} catch (e) {
  throw new Error(
    `county reference data not found at ${GEO} — set COUNTY_GEO_DATA to a directory ` +
      `containing counties.json, zip-to-county.json, place-to-county.json (${e.message})`,
  );
}

export function normalize(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function countyName(fips) {
  const c = counties[fips];
  return c ? `${c.name}, ${c.stateAbbr}` : fips;
}

/** ZIP → county FIPS (highest address share first). */
export function countiesForZip(zip) {
  const arr = zip2county[String(zip)];
  return arr ? arr.map((x) => x[0]) : [];
}

/** city + state → county FIPS (fallback when no ZIP). */
export function countiesForPlace(city, stateAbbr) {
  const st = (stateAbbr || "").toUpperCase();
  return place2county[st]?.[normalize(city)] || [];
}

/** Resolve an address object {full, zip} to county FIPS — ZIP first, then place. */
export function countiesForAddress(addr) {
  if (!addr) return [];
  if (addr.zip) {
    const byZip = countiesForZip(addr.zip);
    if (byZip.length) return byZip;
  }
  const m = String(addr.full || "").match(/,\s*([^,]+),\s*([A-Z]{2})\s*\d{0,5}/);
  if (m) return countiesForPlace(m[1], m[2]);
  return [];
}
