// Export the current machine matches as reviewable crosswalk tables: every roster row
// with its heuristic match (or NONE), and the same-ZIP facility clusters that need a
// human decision on entity boundaries. Output is for maintainer review.
//
// Outputs (CSV, spreadsheet-friendly):
//   data/crosswalk/ice-uwchr-matches.csv   — every ICE roster row: its machine match or NONE
//   data/crosswalk/tx-same-zip-clusters.csv — TX ZIPs where multiple UWCHR facilities share
//                                             one ZIP (the "what is one facility?" cases)
//
// Run:  node scripts/export-crosswalk-seed.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "data/sources");
const OUT = path.join(ROOT, "_internal/crosswalk");
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(SRC, f), "utf8"));

const uwchr = readJson("uwchr-facilities.json");
const ice = readJson("ice-facilities.json");
const byDetloc = new Map(uwchr.map((r) => [r.xref, r]));

const csv = (rows) =>
  rows.map((r) => r.map((c) => {
    const s = c == null ? "" : String(c);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(",")).join("\n") + "\n";

// --- 1. ICE ↔ UWCHR match table ---------------------------------------------
const rows1 = [[
  "ice_slug", "ice_name", "ice_zip", "ice_address",
  "matched_detloc", "uwchr_name", "uwchr_zip", "uwchr_address", "uwchr_function",
  "same_entity? (you decide: yes/no/unsure)", "notes",
]];
for (const r of ice.slice().sort((a, b) => (a.state || "").localeCompare(b.state || "") || a.fields.name[0].value.localeCompare(b.fields.name[0].value))) {
  const matched = !r.xref.startsWith("ice-");
  const u = matched ? byDetloc.get(r.xref) : null;
  rows1.push([
    r.sourceRecordId.replace(/^ice-/, ""), r.fields.name[0].value,
    r.fields.address?.zip || "", r.fields.address?.full || "",
    matched ? r.xref : "NONE",
    u ? u.fields.name[0].value : "", u ? u.fields.address?.zip || "" : "", u ? u.fields.address?.full || "" : "",
    u ? (u.fields.facilityFunction || u.fields.agreement || "") : "",
    "", "",
  ]);
}

// --- 2. TX same-ZIP clusters (co-location ambiguity) --------------------------
const txByZip = new Map();
for (const r of uwchr) {
  if (r.state !== "TX") continue;
  const zip = r.fields.address?.zip;
  if (!zip) continue;
  (txByZip.get(zip) || txByZip.set(zip, []).get(zip)).push(r);
}
const rows2 = [["zip", "n_facilities_at_zip", "detloc", "name", "address", "function", "agreement", "one entity or several? (you decide)", "notes"]];
for (const [zip, recs] of [...txByZip.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length)) {
  for (const r of recs) {
    rows2.push([zip, recs.length, r.xref, r.fields.name[0].value, r.fields.address?.full || "",
      r.fields.facilityFunction || "", r.fields.agreement || "", "", ""]);
  }
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "ice-uwchr-matches.csv"), csv(rows1));
fs.writeFileSync(path.join(OUT, "tx-same-zip-clusters.csv"), csv(rows2));
const matched = ice.filter((r) => !r.xref.startsWith("ice-")).length;
console.log(`✓ ice-uwchr-matches.csv — ${ice.length} ICE rows (${matched} machine-matched, ${ice.length - matched} NONE)`);
console.log(`✓ tx-same-zip-clusters.csv — ${rows2.length - 1} facility rows across ${[...txByZip.values()].filter((v) => v.length > 1).length} shared TX ZIPs`);
