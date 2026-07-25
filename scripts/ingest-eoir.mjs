// Ingest the EOIR (DOJ) immigration-court list from the court operational-status page:
// courts as entities, plus a derived facility→court hint where a court shares a ZIP with
// a detention facility (detained-docket courts are physically co-located). Non-co-located
// jurisdiction is never guessed; those mappings are left absent.
// Run after ingest-uwchr.mjs and ingest-ice.mjs:  node scripts/ingest-eoir.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/sources");
const URL = "https://www.justice.gov/eoir/immigration-court-operational-status";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TODAY = new Date().toISOString().slice(0, 10);

const r = await fetch(URL, { headers: { "User-Agent": UA } });
if (!r.ok) throw new Error(`EOIR fetch → ${r.status}`);
const html = await r.text();

const clean = (s) => (s || "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const span = (b, cls) => (b.match(new RegExp(`class="${cls}"[^>]*>([^<]*)<`)) || [, ""])[1].trim();

const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
const courts = [];
for (const [, row] of rows) {
  const link = row.match(/<a href="(https:\/\/www\.justice\.gov\/eoir\/[^"]+)">([^<]+)<\/a>/);
  if (!link) continue;
  const [, url, name] = link;
  const line1 = span(row, "address-line1"), line2 = span(row, "address-line2");
  const city = span(row, "locality"), state = span(row, "administrative-area"), zip = span(row, "postal-code").slice(0, 5);
  if (!city || !state) continue;
  // line1 is sometimes a building name (e.g. "Port Isabel Processing Center"), line2 the street.
  const street = [line1, line2].filter(Boolean).join(", ");
  const statusCell = row.match(/field-eoir-court-status[^>]*>([\s\S]*?)<\/td>/);
  const status = statusCell ? clean(statusCell[1]) : "";
  const slug = url.split("/").pop();
  courts.push({
    source: "eoir", sourceRecordId: "eoir-" + slug, xref: "court-" + slug,
    kind: "immigration-court", state: state.toUpperCase(), sourceAsOf: TODAY, captured: TODAY, url,
    fields: {
      name: [{ value: /immigration court/i.test(name) ? name.trim() : name.trim() + " Immigration Court", nameType: "official-eoir" }],
      address: { full: [street, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", "), zip },
      operationalStatus: status || undefined,
    },
  });
}

// --- derived co-location: same-ZIP detention facility gets an inferred court hint -----
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")); } catch { return []; } };
const facilities = [...readJson("uwchr-facilities.json"), ...readJson("ice-facilities.json")]
  .filter((rec) => rec.kind === "detention");
const facsByZip = new Map();
for (const rec of facilities) {
  const zip = rec.fields.address?.zip;
  if (zip) (facsByZip.get(zip) || facsByZip.set(zip, new Set()).get(zip)).add(rec.xref);
}
const colocated = [];
for (const c of courts) {
  const zip = c.fields.address?.zip;
  const hits = zip ? facsByZip.get(zip) : null;
  if (!hits) continue;
  for (const xref of hits) {
    colocated.push({
      source: "eoir", sourceRecordId: `eoir-coloc-${c.xref}-${xref}`, xref,
      kind: "detention", sourceAsOf: TODAY, captured: TODAY, url: c.url,
      fields: {
        immigrationCourt: c.fields.name[0].value + " (co-located — same ZIP)",
      },
    });
  }
}

fs.writeFileSync(path.join(OUT, "eoir-courts.json"), JSON.stringify([...courts, ...colocated], null, 1));
const tx = courts.filter((c) => c.state === "TX").length;
console.log(`✓ eoir-courts.json — ${courts.length} immigration courts (${tx} in TX); ${colocated.length} co-located facility→court hints`);
