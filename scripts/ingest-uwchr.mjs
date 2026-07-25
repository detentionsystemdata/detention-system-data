// Ingest real facility data from UWCHR (Univ. of Washington Center for Human Rights)
// `ice-detain` repo — the open, documented pipeline the Deportation Data Project is built
// on and links to. FOIA-derived ICE detention data. Directly fetchable (no Box/Shiny/2.25GB
// dump that DDP's own site gates behind). Writes per-source records into data/sources/ so the
// reconcile + review pipeline treats it like any other source.
//
//   facilities.csv.gz  → one detention facility per row (stable `detloc` code)
//   county_aor.csv     → every county-FIPS → its ERO field-office AOR (→ field-office county sets)
//
// National in (we keep every row); the review applies the Texas OUTPUT filter. Run:
//   node scripts/ingest-uwchr.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { canonAor } from "../lib/aor.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/sources");
const rawBase = (rev) => `https://raw.githubusercontent.com/UWCHR/ice-detain/${rev}`;
const TODAY = new Date().toISOString().slice(0, 10);

// ICE ERO field-office codes → name (+ TX flag drives the review's Texas output filter).
const AOR_INFO = {
  SNA: { name: "San Antonio Field Office", state: "TX" },
  DAL: { name: "Dallas Field Office", state: "TX" },
  HOU: { name: "Houston Field Office", state: "TX" },
  ELP: { name: "El Paso Field Office", state: "TX" },
  HLG: { name: "Harlingen Field Office", state: "TX" },
  NOL: { name: "New Orleans Field Office" }, MIA: { name: "Miami Field Office" },
  ATL: { name: "Atlanta Field Office" }, CHI: { name: "Chicago Field Office" },
  DET: { name: "Detroit Field Office" }, BOS: { name: "Boston Field Office" },
  BUF: { name: "Buffalo Field Office" }, NYC: { name: "New York City Field Office" },
  NEW: { name: "Newark Field Office" }, PHI: { name: "Philadelphia Field Office" },
  BAL: { name: "Baltimore Field Office" }, WAS: { name: "Washington Field Office" },
  SEA: { name: "Seattle Field Office" }, SFR: { name: "San Francisco Field Office" },
  LOS: { name: "Los Angeles Field Office" }, SND: { name: "San Diego Field Office" },
  PHO: { name: "Phoenix Field Office" }, SLC: { name: "Salt Lake City Field Office" },
  DEN: { name: "Denver Field Office" }, SPM: { name: "St. Paul Field Office" },
};

const na = (v) => { const t = (v == null ? "" : String(v)).trim(); return t && t.toUpperCase() !== "NA" ? t : ""; };

function parseCSVLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
  }
  out.push(cur); return out;
}

async function getText(url, gunzip) {
  const r = await fetch(url, { headers: { "User-Agent": "detention-system-ingest" } });
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return gunzip ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

// Resolve the current commit for the dataset file so fetches are PINNED to an immutable
// SHA (supply-chain: raw.githubusercontent.com/main is mutable; a pinned URL is not) and
// the provenance URL records exactly which revision we read.
async function datasetRev() {
  try {
    const r = await fetch(`https://api.github.com/repos/UWCHR/ice-detain/commits?path=analyze/input/facilities.csv.gz&per_page=1`,
      { headers: { "User-Agent": "detention-system-ingest" } });
    const j = await r.json();
    return { date: (j[0]?.commit?.committer?.date || "").slice(0, 10) || TODAY, sha: j[0]?.sha || "main" };
  } catch { return { date: TODAY, sha: "main" }; }
}

// --- facilities -------------------------------------------------------------
function buildFacilities(csv, asOf) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const cols = lines[0].split("|");
  const idx = (k) => cols.indexOf(k);
  const I = {
    detloc: idx("detloc"), name: idx("name"), address: idx("address"), city: idx("city"),
    county: idx("county"), state: idx("state"), zip: idx("zip"), aor: idx("aor"),
    type: idx("type"), typeDetailed: idx("type_detailed"), over72: idx("over_72"),
    capacity: idx("capacity"), circuit: idx("circuit"), docket: idx("docket"),
    authority: idx("authorizing_authority"), guarMin: idx("guaranteed_minimum"),
    lastUse: idx("date_of_last_use"), firstUse: idx("date_of_first_use"), dmcp: idx("dmcp_auth"),
  };
  const recs = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("|");
    const detloc = na(c[I.detloc]); if (!detloc) continue;
    const state = na(c[I.state]).toUpperCase();
    const zip = na(c[I.zip]);
    const addrParts = [na(c[I.address]), na(c[I.city]), [state, zip].filter(Boolean).join(" ")].filter(Boolean);
    // Names publish verbatim as the source writes them (see _docs/data-standards.md).
    const fields = { name: [{ value: na(c[I.name]) || detloc, nameType: "official-dhs" }] };
    if (addrParts.length) fields.address = { full: addrParts.join(", "), zip };
    const county = na(c[I.county]); if (county) fields.county = county.replace(/\s+/g, " ");
    const aor = canonAor(na(c[I.aor])); if (aor) fields.fieldOffice = aor;
    // Three distinct type dimensions — kept separate on purpose (do not collapse):
    // agreement (who runs it / under what contract), function (what happens to people
    // there), and whether people are held beyond 72 hours.
    const agr = na(c[I.type]); if (agr) fields.agreement = agr;
    const fn = na(c[I.typeDetailed]); if (fn && fn !== agr) fields.facilityFunction = fn;
    const o72 = na(c[I.over72]); if (o72) fields.holdsOver72h = o72 === "TRUE" ? "yes" : "no";
    const cap = na(c[I.capacity]); if (cap && !Number.isNaN(Number(cap))) fields.capacity = Number(cap);
    // Jurisdiction, management, contract, and usage-history fields:
    const circ = na(c[I.circuit]); if (circ) fields.circuit = circ;
    const dk = na(c[I.docket]); if (dk) fields.docket = dk;
    const auth = na(c[I.authority]); if (auth) fields.authorizingAuthority = auth;
    const gm = na(c[I.guarMin]); if (gm && !Number.isNaN(Number(gm))) fields.guaranteedMinimumBeds = Number(gm);
    const fu = na(c[I.firstUse]); if (fu) fields.firstUsed = fu;
    const lu = na(c[I.lastUse]); if (lu) fields.lastUsed = lu;
    const dm = na(c[I.dmcp]); if (dm) fields.underDetentionStandards = dm === "TRUE" ? "yes" : "no";
    recs.push({
      source: "uwchr", sourceRecordId: "uwchr-" + detloc, xref: detloc, kind: "detention",
      state, sourceAsOf: asOf, captured: TODAY, url: SRC_URL, fields,
    });
  }
  return recs;
}

// --- field offices (AOR county sets) ----------------------------------------
function buildOffices(csv, asOf) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const head = parseCSVLine(lines[0]);
  const gi = head.indexOf("geoid"), ai = head.indexOf("aor");
  const byAor = new Map();
  for (let i = 1; i < lines.length; i++) {
    const c = parseCSVLine(lines[i]);
    const aor = na(c[ai]); const geoid = na(c[gi]);
    if (!aor || !geoid) continue;
    (byAor.get(canonAor(aor)) || byAor.set(canonAor(aor), []).get(canonAor(aor))).push(geoid.padStart(5, "0"));
  }
  return [...byAor.entries()].map(([aor, geoids]) => {
    const info = AOR_INFO[aor] || {};
    const fields = {
      name: [{ value: info.name || `${aor} Field Office`, nameType: "official-dhs" }],
      fieldOfficeCode: aor,
      aorCounties: [...new Set(geoids)],
    };
    return {
      source: "uwchr", sourceRecordId: "uwchr-aor-" + aor, xref: "ero-" + aor.toLowerCase(),
      kind: "field-office", state: info.state, sourceAsOf: asOf, captured: TODAY,
      url: SRC_URL, fields,
    };
  });
}

const { date: asOf, sha } = await datasetRev();
const SRC_URL = `https://github.com/UWCHR/ice-detain/tree/${sha}`;
console.log(`pinned to UWCHR/ice-detain@${sha.slice(0, 10)} (dataset as of ${asOf})`);

// Discover-only mode: report the resolved commit SHA + its date as JSON, then exit before
// fetching the CSVs. Freshness tooling calls this so its check reuses the same commit
// resolution the full ingest uses (they cannot drift apart).
if (process.argv.includes("--discover")) {
  console.log(JSON.stringify({ source: "uwchr", sha, asOf, url: SRC_URL }));
  process.exit(0);
}
const facCsv = await getText(`${rawBase(sha)}/analyze/input/facilities.csv.gz`, true);
// county_aor_har.csv = the post-FY22 mapping that includes the Harlingen (HAR) carve-out
const aorCsv = await getText(`${rawBase(sha)}/share/hand/county_aor_har.csv`, false);
const facilities = buildFacilities(facCsv, asOf);
const offices = buildOffices(aorCsv, asOf);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "uwchr-facilities.json"), JSON.stringify(facilities, null, 1));
fs.writeFileSync(path.join(OUT, "uwchr-offices.json"), JSON.stringify(offices, null, 1));
const txFac = facilities.filter((r) => r.state === "TX").length;
console.log(`✓ uwchr-facilities.json — ${facilities.length} facilities (${txFac} in TX), dataset as of ${asOf}`);
console.log(`✓ uwchr-offices.json — ${offices.length} field offices (AOR county sets)`);
