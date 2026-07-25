// Enrich ICE roster records from each facility's ice.gov detail page: detainee-information
// phone number and field office (normalized to ERO office codes so values reconcile across
// sources). The facility detail URL is preserved on every record. Note: the specific
// immigration court serving a facility is not published on ice.gov.
// Run after ingest-ice.mjs:  node scripts/ingest-ice-details.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonAor } from "../lib/aor.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "data/sources/ice-facilities.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CONCURRENCY = 6;

const NAME_TO_AOR = {
  "atlanta": "ATL", "baltimore": "BAL", "boston": "BOS", "buffalo": "BUF", "chicago": "CHI",
  "dallas": "DAL", "denver": "DEN", "detroit": "DET", "el paso": "ELP", "harlingen": "HAR",
  "houston": "HOU", "los angeles": "LOS", "miami": "MIA", "new orleans": "NOL",
  "new york city": "NYC", "new york": "NYC", "newark": "NEW", "philadelphia": "PHI",
  "phoenix": "PHO", "salt lake city": "SLC", "san antonio": "SNA", "san diego": "SND",
  "san francisco": "SFR", "seattle": "SEA", "st. paul": "SPM", "st paul": "SPM",
  "saint paul": "SPM", "washington": "WAS",
};

function officeCode(name) {
  const n = (name || "").toLowerCase().replace(/\s*field office\s*$/, "").trim();
  return canonAor(NAME_TO_AOR[n] || name); // unknown names kept verbatim (radically welcoming)
}

async function fetchDetail(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const h = await r.text();
  const office = (h.match(/field--name-field-field-office-name[^>]*>([^<]+)</) || [])[1]?.trim();
  // The detainee-information phone: the number nearest the "housed at this facility" sentence.
  let phone = null;
  const ctx = h.match(/housed at this facility[\s\S]{0,200}?(\(?\d{3}\)?[ .\-]\d{3}[ .\-]\d{4})/i);
  if (ctx) phone = ctx[1].replace(/[.\s]+/g, " ").trim();
  return { office, phone };
}

const recs = JSON.parse(fs.readFileSync(FILE, "utf8"));
let done = 0, gotPhone = 0, gotOffice = 0, failed = 0;

async function worker(queue) {
  for (;;) {
    const rec = queue.shift();
    if (!rec) return;
    try {
      const d = await fetchDetail(rec.url);
      if (d) {
        if (d.phone) { rec.fields.phone = d.phone; gotPhone++; }
        if (d.office) { rec.fields.fieldOffice = officeCode(d.office); gotOffice++; }
      } else failed++;
    } catch { failed++; }
    done++;
    if (done % 25 === 0) console.log(`  …${done}/${recs.length}`);
  }
}

const queue = [...recs];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
fs.writeFileSync(FILE, JSON.stringify(recs, null, 1));
console.log(`✓ enriched ice-facilities.json — phone: ${gotPhone}, field office: ${gotOffice}, failed: ${failed} of ${recs.length}`);
