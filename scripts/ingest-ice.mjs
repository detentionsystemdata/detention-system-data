// Ingest ICE's own facility roster from ice.gov/detention-facilities (public domain).
// Rows carry no shared identifier with other sources, so each is attached to an existing
// facility via the heuristic matcher (lib/scaffold-match.mjs) or kept as its own record.
// Run:  node scripts/ingest-ice.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/sources");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TODAY = new Date().toISOString().slice(0, 10);
const BASE = "https://www.ice.gov/detention-facilities";

import { buildMatcher } from "../lib/scaffold-match.mjs";

async function fetchPage(page) {
  const r = await fetch(`${BASE}?page=${page}`, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`ice.gov page ${page} → ${r.status}`);
  return r.text();
}

function parsePage(html) {
  const names = [...html.matchAll(/href="\/detain\/detention-facilities\/([^"]+)"\s+hreflang="en">([^<]+)<\/a>/g)]
    .map((m) => ({ slug: m[1], name: m[2].trim() }));
  // The <p class="address"> tags are never closed with </p> (invalid Drupal markup), so we
  // match the span sequence directly: line1 → locality → administrative-area → postal-code.
  const addrs = [...html.matchAll(
    /<span class="address-line1">([^<]*)<\/span>[\s\S]{0,80}?<span class="locality">([^<]*)<\/span>[\s\S]{0,40}?<span class="administrative-area">([^<]*)<\/span>\s*<span class="postal-code">([^<]*)<\/span>/g,
  )].map((m) => ({ line1: m[1].trim(), city: m[2].trim(), state: m[3].trim(), zip: m[4].trim() }));
  const n = Math.min(names.length, addrs.length);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ ...names[i], ...addrs[i] });
  return out;
}

// --- run (matcher shared via lib/scaffold-match.mjs) --------------------------
const match = buildMatcher();
const rows = [];
for (let page = 0; page < 20; page++) {
  const items = parsePage(await fetchPage(page));
  if (!items.length) break;
  rows.push(...items);
}

let matched = 0;
const recs = rows.map((f) => {
  const zip = (f.zip || "").slice(0, 5);
  const detloc = zip ? match(f.name, zip) : null;
  if (detloc) matched++;
  const addrParts = [f.line1, f.city, [f.state, zip].filter(Boolean).join(" ")].filter(Boolean);
  const fields = { name: [{ value: f.name, nameType: "official-dhs" }] };
  if (addrParts.length) fields.address = { full: addrParts.join(", "), zip };
  return {
    source: "ice", sourceRecordId: "ice-" + f.slug, xref: detloc || "ice-" + f.slug,
    kind: "detention", state: (f.state || "").toUpperCase(), sourceAsOf: TODAY, captured: TODAY,
    url: "https://www.ice.gov/detain/detention-facilities/" + f.slug, fields,
  };
});

fs.writeFileSync(path.join(OUT, "ice-facilities.json"), JSON.stringify(recs, null, 1));
const tx = recs.filter((r) => r.state === "TX").length;
console.log(`✓ ice-facilities.json — ${recs.length} facilities from ice.gov (${tx} in TX)`);
console.log(`  matched to a UWCHR facility (shared entity): ${matched} · ICE-only (new entity): ${recs.length - matched}`);
