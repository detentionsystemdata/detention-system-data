// ERO field-office code canonicalization. Different ICE products abbreviate the same
// office differently — e.g. the website labels the Harlingen office and its detail pages
// resolve to HAR, while ICE's own statistics workbook uses HLG. We canonicalize to the
// code ICE's authoritative statistics use, so the same office converges across sources
// instead of reading as a disagreement.
export const AOR_ALIAS = { HAR: "HLG" };
export const canonAor = (code) => (code && AOR_ALIAS[code]) || code || "";


// ERO field-office name → code (some sources label facilities/offices by the full name).
export const AOR_NAME_TO_CODE = {
  "atlanta": "ATL", "baltimore": "BAL", "boston": "BOS", "buffalo": "BUF", "chicago": "CHI",
  "dallas": "DAL", "denver": "DEN", "detroit": "DET", "el paso": "ELP", "harlingen": "HLG",
  "houston": "HOU", "los angeles": "LOS", "miami": "MIA", "new orleans": "NOL",
  "new york city": "NYC", "newark": "NEW", "philadelphia": "PHI", "phoenix": "PHO",
  "saint paul": "SPM", "st. paul": "SPM", "st paul": "SPM", "salt lake city": "SLC",
  "san antonio": "SNA", "san diego": "SND", "san francisco": "SFR", "seattle": "SEA",
  "washington d.c.": "WAS", "washington": "WAS",
};
export const aorNameToCode = (name) =>
  canonAor(AOR_NAME_TO_CODE[(name || "").toLowerCase().replace(/\s+(aor|field office)\s*$/, "").trim()] || "");
