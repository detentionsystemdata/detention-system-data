// Heuristic entity matcher used when a source carries no facility code: blocks on ZIP,
// scores by name-token overlap. Deliberately simple and conservative; a fuller matching
// specification will replace it. Ambiguous candidates are left unmatched rather than merged.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["ice", "ero", "processing", "center", "centre", "detention", "facility", "fclty", "correctional", "corr", "county", "service", "spc", "the", "of", "and", "jail", "adult", "residential", "staging", "hold", "room", "holding", "iah", "det", "co"]);
export const tokset = (s) => new Set(norm(s).split(" ").filter((t) => t && !STOP.has(t)));
export const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };

/** Build (name, zip) → UWCHR detloc | null from data/sources/uwchr-facilities.json. */
export function buildMatcher() {
  let uwchr = [];
  try { uwchr = JSON.parse(fs.readFileSync(path.join(ROOT, "data/sources/uwchr-facilities.json"), "utf8")); }
  catch { console.log("  ! uwchr-facilities.json not found — rows will all be new entities"); }
  const byZip = new Map();
  for (const r of uwchr) {
    const zip = r.fields.address?.zip;
    const name = r.fields.name?.[0]?.value || "";
    const entry = { detloc: r.xref, tokens: tokset(name) };
    if (zip) (byZip.get(zip) || byZip.set(zip, []).get(zip)).push(entry);
  }
  return (name, zip) => {
    const cands = byZip.get(zip) || [];
    if (!cands.length) return null;
    const t = tokset(name);
    let best = null, bestScore = 0;
    for (const c of cands) {
      const s = jaccard(t, c.tokens);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    // same ZIP + any shared distinctive token (or a lone candidate at that ZIP) = same entity.
    if (best && (bestScore > 0 || cands.length === 1)) return best.detloc;
    return null;
  };
}
