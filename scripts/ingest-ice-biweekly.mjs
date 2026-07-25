// Ingest ICE's fiscal-year-to-date detention statistics workbook — the facility-level
// file where current populations (ADP by security level), average length of stay, and
// inspection outcomes live. Discovers the newest file from the detention-management page
// (the filename embeds its as-of date and changes per release). Parses the Facilities
// sheet without an xlsx dependency; every column is ingested (known columns map to
// canonical fields, the rest are kept verbatim under slugged keys).
// Run after ingest-uwchr.mjs:  node scripts/ingest-ice-biweekly.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildMatcher, norm } from "../lib/scaffold-match.mjs";
import { canonAor } from "../lib/aor.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/sources");
const RAW = path.join(ROOT, "_data/raw");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TODAY = new Date().toISOString().slice(0, 10);

// --- 1. discover the newest stats workbook -----------------------------------
const page = await (await fetch("https://www.ice.gov/detain/detention-management", { headers: { "User-Agent": UA } })).text();
const links = [...page.matchAll(/href="(https:\/\/www\.ice\.gov\/doclib\/detention\/FY(\d+)[_-]?detention[Ss]tats[_-]?(\d{8})?\.xlsx)"/g)]
  .map((m) => ({ url: m[1], fy: +m[2], mmddyyyy: m[3] || "" }))
  .sort((a, b) => b.fy - a.fy || b.mmddyyyy.localeCompare(a.mmddyyyy));
if (!links.length) throw new Error("no detention-stats xlsx found on the page — layout changed?");
const file = links[0];
const asOf = file.mmddyyyy
  ? `${file.mmddyyyy.slice(4)}-${file.mmddyyyy.slice(0, 2)}-${file.mmddyyyy.slice(2, 4)}`
  : TODAY;
console.log(`newest: FY${file.fy} — ${file.url} (as of ${asOf})`);

// Discover-only mode: report the newest workbook + its as-of date as JSON, then exit
// before downloading or parsing. Freshness tooling calls this so its check is the same
// discovery logic the full ingest uses (they cannot drift apart).
if (process.argv.includes("--discover")) {
  console.log(JSON.stringify({ source: "ice-biweekly", fy: file.fy, asOf, url: file.url }));
  process.exit(0);
}

fs.mkdirSync(RAW, { recursive: true });
const xlsxPath = path.join(RAW, path.basename(file.url));
const buf = Buffer.from(await (await fetch(file.url, { headers: { "User-Agent": UA } })).arrayBuffer());
fs.writeFileSync(xlsxPath, buf);
// Record the artifact hash so any release built from this file is verifiable end-to-end.
const { createHash } = await import("node:crypto");
const sha256 = createHash("sha256").update(buf).digest("hex");
fs.writeFileSync(xlsxPath + ".sha256", `${sha256}  ${path.basename(file.url)}\n`);
console.log(`sha256: ${sha256.slice(0, 16)}… (recorded next to the file)`);

// --- 2. no-dependency xlsx parsing (unzip -p + regex) -------------------------
const unzip = (entry) => execFileSync("unzip", ["-p", xlsxPath, entry], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
const wb = unzip("xl/workbook.xml");
const rels = unzip("xl/_rels/workbook.xml.rels");
const relmap = Object.fromEntries([...rels.matchAll(/Id="rId(\d+)"[^>]*Target="worksheets\/(sheet\d+\.xml)"/g)].map((m) => [m[1], m[2]]));
const sheetEntry = [...wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="rId(\d+)"/g)]
  .find(([, name]) => /facilities/i.test(name));
if (!sheetEntry) throw new Error("no 'Facilities' sheet in workbook");
const sheetXml = unzip("xl/worksheets/" + relmap[sheetEntry[2]]);
const strings = [...unzip("xl/sharedStrings.xml").matchAll(/<si>(.*?)<\/si>/gs)].map((m) => m[1].replace(/<[^>]+>/g, ""));


const colIdx = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const rows = [...sheetXml.matchAll(/<row[^>]*>(.*?)<\/row>/gs)].map(([, r]) => {
  const cells = [];
  for (const m of r.matchAll(/<c ([^>]*)>(?:<v>([^<]*)<\/v>)?/g)) {
    const [, attrs, v] = m;
    if (v == null) continue;
    const col = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
    if (!col) continue;
    const shared = /(?:^|\s)t="s"/.test(attrs);
    cells[colIdx(col)] = shared ? strings[+v] : v;
  }
  return cells;
});

// header = the row containing both Name and Zip
const hi = rows.findIndex((r) => r?.includes("Name") && r?.includes("Zip"));
if (hi < 0) throw new Error("header row not found");
const headers = rows[hi];

// --- 3. column mapping (known → canonical; unknown → slugged, kept) -----------
const slug = (h) => norm(h.replace(/FY\s*\d+/i, "")).split(" ").map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("");
const excelDate = (v) => { const n = +v; if (!n || n < 20000) return v; const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return d.toISOString().slice(0, 10); };
const round1 = (v) => Math.round(+v * 10) / 10;

const match = buildMatcher();
const recs = [];
let matched = 0;
for (let i = hi + 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r) continue;
  const get = (label) => { const j = headers.findIndex((h) => h === label); return j >= 0 ? r[j] : undefined; };
  const name = get("Name");
  if (!name || !get("Zip")) continue; // footnote / spacer rows
  const zip = String(get("Zip")).slice(0, 5).padStart(5, "0");
  const state = String(get("State") || "").toUpperCase();

  const fields = { name: [{ value: name.trim(), nameType: "official-dhs" }] }; // verbatim (Option A)
  const addr = [get("Address"), get("City"), [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (addr) fields.address = { full: addr, zip };
  if (get("AOR")) fields.fieldOffice = canonAor(get("AOR"));
  if (get("Type Detailed")) fields.agreement = get("Type Detailed");
  if (get("Male/Female")) fields.genderServed = get("Male/Female");

  let adpTotal = 0, levels = 0;
  for (const [j, h] of headers.entries()) {
    if (r[j] == null || r[j] === "") continue;
    if (/^Level [A-D]$/.test(h)) { const v = round1(r[j]); fields["adp" + h.replace(" ", "")] = v; adpTotal += v; levels++; continue; }
    if (/ALOS/i.test(h)) { fields.avgLengthOfStayDays = round1(r[j]); continue; }
    if (/guaranteed/i.test(h)) { const n = +r[j]; if (n) fields.guaranteedMinimumBeds = n; continue; }
    if (["Name", "Address", "City", "State", "Zip", "AOR", "Type Detailed", "Male/Female"].includes(h)) continue;
    // unknown column — keep verbatim under a slugged key (dates converted from Excel serials)
    fields[slug(h)] = /date/i.test(h) ? excelDate(r[j]) : (isNaN(+r[j]) ? r[j] : round1(r[j]));
  }
  if (levels) fields.adpTotal = round1(adpTotal);

  const detloc = match(name, zip);
  if (detloc) matched++;
  recs.push({
    source: "ice-biweekly", sourceRecordId: "biweekly-" + norm(name).replace(/ /g, "-").slice(0, 40) + "-" + zip,
    xref: detloc || "biweekly-" + norm(name).replace(/ /g, "-").slice(0, 40), kind: "detention",
    state, sourceAsOf: asOf, captured: TODAY, url: file.url, fields,
  });
}

fs.writeFileSync(path.join(OUT, "ice-biweekly.json"), JSON.stringify(recs, null, 1));
const tx = recs.filter((r) => r.state === "TX").length;
console.log(`✓ ice-biweekly.json — ${recs.length} facilities with FY${file.fy} statistics (${tx} in TX)`);
console.log(`  matched to UWCHR entities: ${matched} · new entities: ${recs.length - matched}`);
console.log(`  columns seen: ${headers.filter(Boolean).join(" | ")}`);
