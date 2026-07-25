// Ingest ICE ERO field-office contact details from ice.gov/contact/field-offices — the
// current page listing each Enforcement and Removal Operations field office with its address,
// phone, and area of responsibility. Public domain. Enriches our (thin) field-office records.
//
// The page is a paginated (8 pages) Drupal contact directory that MIXES ERO field offices with
// OPLA legal offices and HSI — we filter to titles ending in "Field Office" (ERO only).
// Offices match our existing entities by code (title → code via lib/aor.mjs).
//
// Run:  node scripts/ingest-ice-field-offices.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aorNameToCode } from "../lib/aor.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/sources");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const BASE = "https://www.ice.gov/contact/field-offices";
const TODAY = new Date().toISOString().slice(0, 10);

async function page(n) {
  const r = await fetch(`${BASE}?page=${n}`, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`field-offices page ${n} → ${r.status}`);
  return r.text();
}

const span = (b, cls) => (b.match(new RegExp(`class="${cls}"[^>]*>([^<]*)<`)) || [, ""])[1].trim();
const firstText = (b) => { const m = b.match(/>\s*([^<>|]+?)\s*</); return m ? m[1].trim() : ""; };

const recs = [];
const seen = new Set();
for (let n = 0; n < 8; n++) {
  const html = await page(n);
  // each office row starts at the title field; split and parse each block
  const blocks = html.split('class="views-field views-field-title"').slice(1);
  for (const b of blocks) {
    const name = firstText(b);
    if (!/field office\s*$/i.test(name)) continue;         // ERO only (skip OPLA/HSI/other)
    const code = aorNameToCode(name);
    if (!code || seen.has(code)) continue;                  // need a code; de-dupe
    seen.add(code);
    const line1 = span(b, "address-line1"), line2 = span(b, "address-line2");
    const city = span(b, "locality"), state = span(b, "administrative-area"), zip = span(b, "postal-code").slice(0, 5);
    const phone = (b.match(/\(?\d{3}\)?[ .\-]\d{3}[ .\-]\d{4}/) || [])[0] || "";
    const aor = (b.match(/Area of Responsibility:[\s\S]{0,40}?>\s*([^<]+?)\s*</i) || [])[1] || "";
    const fields = { name: [{ value: name, nameType: "official-dhs" }] };
    const street = [line1, line2].filter(Boolean).join(", ");
    if (street && city) fields.address = { full: [street, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", "), zip };
    if (phone) fields.phone = phone.replace(/[.\s]+/g, " ").trim();
    if (aor) fields.areaOfResponsibility = aor;
    recs.push({
      source: "ice-field-offices", sourceRecordId: "ero-office-" + code,
      xref: "ero-" + code.toLowerCase(), kind: "field-office",
      state, sourceAsOf: TODAY, captured: TODAY, url: `${BASE}`, fields,
    });
  }
}

fs.writeFileSync(path.join(OUT, "ice-field-offices.json"), JSON.stringify(recs, null, 1));
console.log(`✓ ice-field-offices.json — ${recs.length} ERO field offices with contact details`);
console.log(`  codes: ${recs.map((r) => r.xref.replace("ero-", "").toUpperCase()).sort().join(", ")}`);
