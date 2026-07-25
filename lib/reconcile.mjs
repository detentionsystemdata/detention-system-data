// Reconcile raw per-source records into merged facilities: per-field union of source
// values, a derived agreement signal (single/converged/conflict), and a source-weighted
// suggested primary. Values from all-rights-reserved sources are withheld from publication
// and carried only as attributed link-outs. Records are currently grouped by an explicit
// `xref` key assigned at ingest; a fuller entity-matching specification will replace it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countiesForAddress, countyName } from "./geo-adapter.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const NUMERIC_TOLERANCE = 0.1; // converged if values within 10%
const RESERVED = new Set(["name", "aorCounties", "aorNote"]);

function loadSources() {
  const dir = path.join(ROOT, "data/sources");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => readJson(path.join(dir, f)));
}

function certaintyFor(agreement) {
  if (agreement === "converged") return "verified";
  if (agreement === "conflict") return "needs-review";
  return "inferred"; // single
}

const num = (v) => (typeof v === "number" ? v : Number(v));
const isNum = (v) => v != null && v !== "" && !Number.isNaN(num(v));
const displayOf = (v) =>
  v && typeof v === "object" ? v.full ?? JSON.stringify(v) : String(v);
const cmpOf = (v) =>
  isNum(v)
    ? String(num(v))
    : displayOf(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Build one resolved Field from the citations that asserted key `k`. */
function reconcileField(entries, manifest) {
  const cites = entries.map((e) => ({
    source: e.source,
    // numbers stay numbers; only objects (addresses) flatten to their display form
    value: isNum(e.value) ? num(e.value) : displayOf(e.value),
    raw: e.value,
    license: manifest.sources[e.source]?.license ?? "green",
    weight: manifest.sources[e.source]?.weight ?? 0.5,
    sourceAsOf: e.sourceAsOf,
    captured: e.captured,
    url: e.url,
    _cmp: cmpOf(e.value),
    _num: isNum(e.value) ? num(e.value) : null,
  }));

  const pub = cites.filter((c) => c.license !== "red");
  let agreement;
  if (pub.length <= 1) agreement = "single";
  else if (pub.every((c) => c._num != null)) {
    const ns = pub.map((c) => c._num);
    const spread = (Math.max(...ns) - Math.min(...ns)) / (Math.max(...ns) || 1);
    agreement = spread <= NUMERIC_TOLERANCE ? "converged" : "conflict";
  } else {
    agreement = new Set(pub.map((c) => c._cmp)).size === 1 ? "converged" : "conflict";
  }

  const ranked = [...pub].sort(
    (a, b) => b.weight - a.weight || String(b.sourceAsOf).localeCompare(String(a.sourceAsOf)),
  );
  const primary = ranked[0] || null;

  return {
    values: cites.map(({ _cmp, _num, ...c }) => c),
    agreement,
    certainty: certaintyFor(agreement),
    suggestedPrimary: primary ? primary.value : null,
    suggestedPrimarySource: primary ? primary.source : null,
    withheld: pub.length === 0, // every source red → link-out only
  };
}

function reconcileNames(records, manifest) {
  const variants = [];
  for (const r of records) {
    for (const n of r.fields.name || []) {
      const license = manifest.sources[r.source]?.license ?? "green";
      variants.push({
        value: n.value,
        nameType: n.nameType,
        lang: n.lang,
        source: r.source,
        weight: manifest.sources[r.source]?.weight ?? 0.5,
        license,
        certainty:
          n.nameType === "official-dhs" && license !== "red" ? "confirmed" : "plausible",
      });
    }
  }
  const official = variants.filter((v) => v.nameType === "official-dhs" && v.license !== "red");
  const distinctOfficial = new Set(official.map((v) => v.value.toLowerCase()));
  let nameAgreement;
  if (distinctOfficial.size > 1) nameAgreement = "conflict";
  else if (official.length >= 2) nameAgreement = "converged";
  else nameAgreement = "single";

  const pool = (official.length ? official : variants.filter((v) => v.license !== "red"));
  const primary = [...pool].sort((a, b) => b.weight - a.weight)[0];
  return {
    names: variants,
    nameAgreement,
    suggestedPrimaryName: primary ? primary.value : records[0]?.xref || "(unnamed)",
  };
}

function reconcileCounty(records, kind) {
  // Field office → AOR county set; detention → derive from addresses.
  if (kind === "field-office") {
    const fips = [...new Set(records.flatMap((r) => r.fields.aorCounties || []))];
    return {
      fips,
      names: fips.map(countyName),
      agreement: "single",
      resolved: fips.length > 0,
      basis: "aor",
    };
  }
  const perSource = records
    .filter((r) => r.fields.address)
    .map((r) => ({ source: r.source, set: countiesForAddress(r.fields.address) }))
    .filter((x) => x.set.length);
  const fips = [...new Set(perSource.flatMap((x) => x.set))];
  const sigs = new Set(perSource.map((x) => [...x.set].sort().join(",")));
  const agreement = perSource.length <= 1 ? "single" : sigs.size === 1 ? "converged" : "conflict";
  return {
    fips,
    names: fips.map(countyName),
    agreement,
    resolved: fips.length > 0,
    basis: fips.length ? "address" : "none",
  };
}

export function reconcile() {
  const manifest = readJson(path.join(ROOT, "data/manifest.json"));
  const records = loadSources();
  const byXref = new Map();
  for (const r of records) (byXref.get(r.xref) || byXref.set(r.xref, []).get(r.xref)).push(r);

  const facilities = [...byXref.entries()].map(([xref, recs]) => {
    const kind = recs[0].kind;
    const { names, nameAgreement, suggestedPrimaryName } = reconcileNames(recs, manifest);

    // gather every non-reserved field key across records
    const keys = new Set();
    for (const r of recs) for (const k of Object.keys(r.fields)) if (!RESERVED.has(k)) keys.add(k);

    const fields = {};
    for (const k of keys) {
      const entries = recs
        .filter((r) => k in r.fields)
        .map((r) => ({
          source: r.source,
          value: r.fields[k],
          sourceAsOf: r.sourceAsOf,
          captured: r.captured,
          url: r.url,
        }));
      fields[k] = reconcileField(entries, manifest);
    }

    return {
      canonicalId: xref,
      kind,
      names,
      nameAgreement,
      suggestedPrimaryName,
      county: reconcileCounty(recs, kind),
      fields,
      states: [...new Set(recs.map((r) => r.state).filter(Boolean))],
      sourceRecordIds: recs.map((r) => r.sourceRecordId),
    };
  });

  return { generatedAt: new Date().toISOString(), manifest, facilities };
}
