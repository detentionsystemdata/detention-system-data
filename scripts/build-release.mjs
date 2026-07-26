// Build a dated, reproducible release — the public data artifact.
//
//   releases/YYYY.MM.DD/
//     facilities.json / field_offices.json / immigration_courts.json  (nested, per-field
//        provenance — the machine-canonical files)
//     facilities.csv / field_offices.csv / immigration_courts.csv     (flat, primary values)
//     datapackage.json   (Frictionless metadata)
//     sources.json       (manifest: every source, license, vintage, artifact hashes, counts)
//     CHANGELOG.md       (diff vs the previous release)
//     README.md          (what this is, how to cite, license posture)
//     tx/                (the Texas output-filter cut of all of the above data files)
//
// SAFETY INVARIANTS (throw, never warn):
//   - No red-licensed VALUE ships. Red citations are reduced to attributed link-outs
//     ({source, url}) with the value REMOVED. Enforced here, not only in the review page.
//   - Deterministic output (stable sort by canonicalId) so diffs are meaningful.
//
// GeoJSON is deliberately deferred until facilities carry centroids (county FIPS ships in
// every record now; coordinates come with the geo-centroid bake). Noted in the README.
//
// Run:  node scripts/build-release.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconcile } from "../lib/reconcile.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const today = new Date();
const TAG = `${today.getUTCFullYear()}.${String(today.getUTCMonth() + 1).padStart(2, "0")}.${String(today.getUTCDate()).padStart(2, "0")}`;
const DIR = path.join(ROOT, "releases", TAG);

const { generatedAt, manifest, facilities } = reconcile();
const lic = (src) => manifest.sources[src]?.license ?? "green";

// The biweekly workbook's own as-of date (embedded in its filename), read from the actual
// ingested data rather than repeated as a separate literal that can drift out of sync with it.
const biweeklyAsOf = (() => {
  try {
    const recs = JSON.parse(fs.readFileSync(path.join(ROOT, "data/sources/ice-biweekly.json"), "utf8"));
    return recs[0]?.sourceAsOf ?? "unknown";
  } catch {
    return "unknown";
  }
})();

// --- publish transform: strip red values, keep attributed link-outs -----------
function publishField(fl) {
  const pub = fl.values.filter((v) => lic(v.source) !== "red");
  const red = fl.values.filter((v) => lic(v.source) === "red");
  const out = {
    value: fl.withheld ? null : fl.suggestedPrimary,
    agreement: fl.agreement,
    certainty: fl.certainty,
    sources: pub.map((v) => ({
      source: v.source, value: v.value, sourceAsOf: v.sourceAsOf ?? null,
      captured: v.captured ?? null, url: v.url ?? null,
    })),
  };
  if (red.length) {
    out.withheld = fl.withheld; // true = no publishable value at all
    out.linkOuts = red.map((v) => ({ source: v.source, url: v.url ?? manifest.sources[v.source]?.source_url ?? null }));
  }
  return out;
}

function publishFacility(f) {
  return {
    id: f.canonicalId,
    kind: f.kind,
    names: f.names.filter((n) => lic(n.source) !== "red")
      .map((n) => ({ value: n.value, nameType: n.nameType, lang: n.lang ?? null, source: n.source, certainty: n.certainty })),
    primaryName: f.suggestedPrimaryName,
    nameAgreement: f.nameAgreement,
    county: { fips: [...f.county.fips].sort(), names: f.county.names, agreement: f.county.agreement, basis: f.county.basis },
    states: [...(f.states || [])].sort(),
    fields: Object.fromEntries(Object.entries(f.fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, fl]) => [k, publishField(fl)])),
    sourceRecordIds: [...f.sourceRecordIds].sort(),
  };
}

const published = facilities.map(publishFacility).sort((a, b) => a.id.localeCompare(b.id));

// --- safety assertions ---------------------------------------------------------
for (const rec of published) {
  for (const [k, fl] of Object.entries(rec.fields)) {
    for (const s of fl.sources) if (lic(s.source) === "red")
      throw new Error(`RED VALUE LEAKED: ${rec.id}.${k} from ${s.source}`);
    if (fl.value !== null && fl.withheld) throw new Error(`WITHHELD FIELD HAS VALUE: ${rec.id}.${k}`);
  }
  for (const n of rec.names) if (lic(n.source) === "red") throw new Error(`RED NAME LEAKED: ${rec.id}`);
}
const kinds = { detention: "facilities", "field-office": "field_offices", "immigration-court": "immigration_courts" };
if (published.filter((r) => r.kind === "detention").length < 1000) throw new Error("implausibly few facilities — refusing to release");

// --- emit ------------------------------------------------------------------------
const isTX = (r) => r.states.includes("TX") || r.county.fips.some((x) => /^48/.test(x));
const csvEsc = (c) => { const s = c == null ? "" : String(c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

function flatCsv(recs) {
  const fieldKeys = [...new Set(recs.flatMap((r) => Object.keys(r.fields)))].sort();
  const head = ["id", "kind", "primary_name", "name_agreement", "county_fips", "county_names", "states",
    ...fieldKeys.flatMap((k) => [k, k + "_agreement", k + "_n_sources"])];
  const rows = recs.map((r) => [
    r.id, r.kind, r.primaryName, r.nameAgreement, r.county.fips.join("|"), r.county.names.join("|"), r.states.join("|"),
    ...fieldKeys.flatMap((k) => { const fl = r.fields[k]; return fl ? [fl.value, fl.agreement, fl.sources.length] : ["", "", ""]; }),
  ]);
  return [head, ...rows].map((r) => r.map(csvEsc).join(",")).join("\n") + "\n";
}

function emit(dir, recs) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [kind, base] of Object.entries(kinds)) {
    const subset = recs.filter((r) => r.kind === kind);
    fs.writeFileSync(path.join(dir, base + ".json"), JSON.stringify({ release: TAG, generatedAt, count: subset.length, records: subset }, null, 1));
    fs.writeFileSync(path.join(dir, base + ".csv"), flatCsv(subset));
  }
}
emit(DIR, published);
emit(path.join(DIR, "tx"), published.filter(isTX));

// sources manifest + artifact hashes
const hashes = {};
const rawDir = path.join(ROOT, "_data/raw");
if (fs.existsSync(rawDir)) for (const f of fs.readdirSync(rawDir).filter((x) => x.endsWith(".sha256")))
  hashes[f.replace(/\.sha256$/, "")] = fs.readFileSync(path.join(rawDir, f), "utf8").trim().split(/\s+/)[0];
const activeSources = [...new Set(published.flatMap((r) => Object.values(r.fields).flatMap((fl) => fl.sources.map((s) => s.source))))];
fs.writeFileSync(path.join(DIR, "sources.json"), JSON.stringify({
  release: TAG, generatedAt, activeSources,
  sources: manifest.sources, artifactHashes: hashes,
  counts: Object.fromEntries(Object.entries(kinds).map(([k, b]) => [b, published.filter((r) => r.kind === k).length])),
}, null, 1));

// Frictionless datapackage
fs.writeFileSync(path.join(DIR, "datapackage.json"), JSON.stringify({
  name: "detention-system-data", title: "Detention System Data — U.S. immigration detention system registry",
  version: TAG,
  description: "Facts-only registry of ICE detention facilities, ERO field offices, and EOIR immigration courts, compiled from public sources with per-field citations. Conflicting source values are preserved and flagged, never silently resolved. All-rights-reserved sources appear only as attributed link-outs, never as values.",
  licenses: [{ name: "CC0-1.0", title: "CC0 1.0 (our compilation; upstream facts are public-domain or attributed)", path: "https://creativecommons.org/publicdomain/zero/1.0/" }],
  resources: Object.values(kinds).flatMap((b) => [
    { name: b, path: b + ".json", format: "json", mediatype: "application/json" },
    { name: b + "-csv", path: b + ".csv", format: "csv", mediatype: "text/csv" },
  ]),
}, null, 1));

// changelog vs previous release
const relRoot = path.join(ROOT, "releases");
const prev = fs.readdirSync(relRoot).filter((d) => /^\d{4}\.\d{2}\.\d{2}$/.test(d) && d < TAG).sort().pop();
let changelog = `# ${TAG}\n\nGenerated ${generatedAt}. `;
if (!prev) changelog += "First release.\n";
else {
  const load = (tag, base) => { try { return JSON.parse(fs.readFileSync(path.join(relRoot, tag, base + ".json"), "utf8")).records; } catch { return []; } };
  changelog += `Diff vs ${prev}:\n\n`;
  for (const base of Object.values(kinds)) {
    const A = new Map(load(prev, base).map((r) => [r.id, r])), B = new Map(load(TAG, base).map((r) => [r.id, r]));
    const added = [...B.keys()].filter((k) => !A.has(k)), removed = [...A.keys()].filter((k) => !B.has(k));
    const changed = [...B.keys()].filter((k) => A.has(k) && JSON.stringify(A.get(k)) !== JSON.stringify(B.get(k)));
    changelog += `## ${base}\n- ${added.length} added, ${removed.length} removed, ${changed.length} changed (of ${B.size})\n`;
    const list = (label, ids) => { if (ids.length) changelog += `- ${label}: ${ids.slice(0, 15).join(", ")}${ids.length > 15 ? ` …+${ids.length - 15}` : ""}\n`; };
    list("added", added); list("removed", removed); list("changed", changed);
    changelog += "\n";
  }
}
fs.writeFileSync(path.join(DIR, "CHANGELOG.md"), changelog);

fs.writeFileSync(path.join(DIR, "README.md"), `# Detention System Data — release ${TAG}

## ⚠️ Do not rely on this dataset alone

This is an **early-stage compilation of public sources**, provided as-is. Values may be
**wrong, stale, duplicated, or incomplete.** Before acting on anything here — especially
any decision involving a detained person — **verify with primary sources**:

- **Finding a person:** ICE's Online Detainee Locator — https://locator.ice.gov
- **A facility's official page:** https://www.ice.gov/detention-facilities
- **Immigration courts:** https://www.justice.gov/eoir (or call the EOIR hotline, 1-800-898-7180)
- **The sources cited on each record** — every value carries its source and its date
  (\`sourceAsOf\`); check how old a fact is before trusting it.

This project asserts nothing of its own: it compiles what public sources say and shows
where each value came from. It is **not legal advice**. If you find an error, email
detentionsystemdata@gmail.com or open an issue — **and show us the public source.**

## Known limitations (current)

- **Possible duplicate records.** Cross-source matching is heuristic (same ZIP + name
  overlap); a facility may appear more than once, and some merges may be wrong.
- The UWCHR base file is dated **2025-01-31** — attributes from it may be outdated.
- Field-office assignments disagree between sources in South Texas (the Harlingen
  carve-out); disagreements are shown, not resolved.
- \`immigrationCourt\` values are **same-ZIP co-location inferences**, not jurisdiction.
- Populations/statistics come from the most recent ICE workbook (**as of ${biweeklyAsOf}**);
  ICE publishes intermittently.
- No coordinates/GeoJSON yet (county FIPS ships on every record).


A facts-only registry of the U.S. immigration detention system — **detention facilities,
ERO field offices, and EOIR immigration courts** — compiled from public sources with
**per-field citations**. Conflicting source values are preserved and flagged (\`agreement:
"conflict"\`), never silently resolved. Values from all-rights-reserved sources are
**withheld** and appear only as attributed link-outs.

- \`*.json\` — canonical records: every field carries its sources, dates, and agreement signal.
- \`*.csv\` — flat convenience cut (suggested-primary values + agreement + source count).
- \`tx/\` — the Texas output-filter cut (same shape; the national files are the registry).
- \`sources.json\` — what fed this release: source list, licenses, vintages, artifact hashes.
- \`CHANGELOG.md\` — what changed since the previous release.

County FIPS (5-digit, string) ships on every record. GeoJSON with centroids is planned;
records are join-ready against Census county geographies today via \`county.fips\`.

Staleness is data: each value's \`sourceAsOf\` is the date the SOURCE reported it, which may
lag \`captured\`. Sources publish intermittently; we hold last-known-good and show its age.
`);

const total = published.length;
console.log(`✓ release ${TAG} → releases/${TAG}/  (${total} records: ${published.filter((r) => r.kind === "detention").length} facilities, ${published.filter((r) => r.kind === "field-office").length} offices, ${published.filter((r) => r.kind === "immigration-court").length} courts; TX cut: ${published.filter(isTX).length})`);
console.log(`  safety: red-withholding assertions passed; ${Object.keys(hashes).length} artifact hash(es) recorded${prev ? `; diffed vs ${prev}` : "; first release"}`);
