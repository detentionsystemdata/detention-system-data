# Detention System Data — release 2026.07.25

## ⚠️ Do not rely on this dataset alone

This is an **early-stage compilation of public sources**, provided as-is. Values may be
**wrong, stale, duplicated, or incomplete.** Before acting on anything here — especially
any decision involving a detained person — **verify with primary sources**:

- **Finding a person:** ICE's Online Detainee Locator — https://locator.ice.gov
- **A facility's official page:** https://www.ice.gov/detention-facilities
- **Immigration courts:** https://www.justice.gov/eoir (or call the EOIR hotline, 1-800-898-7180)
- **The sources cited on each record** — every value carries its source and its date
  (`sourceAsOf`); check how old a fact is before trusting it.

This project asserts nothing of its own: it compiles what public sources say and shows
where each value came from. It is **not legal advice**. If you find an error, email
detentionsystemdata@gmail.com or open an issue — **and show us the public source.**

## Known limitations (current)

- **Possible duplicate records.** Cross-source matching is heuristic (same ZIP + name
  overlap); a facility may appear more than once, and some merges may be wrong.
- The UWCHR base file is dated **2025-01-31** — attributes from it may be outdated.
- Field-office assignments disagree between sources in South Texas (the Harlingen
  carve-out); disagreements are shown, not resolved.
- `immigrationCourt` values are **same-ZIP co-location inferences**, not jurisdiction.
- Populations/statistics come from the most recent ICE workbook (**as of 2026-04-09**);
  ICE publishes intermittently.
- No coordinates/GeoJSON yet (county FIPS ships on every record).


A facts-only registry of the U.S. immigration detention system — **detention facilities,
ERO field offices, and EOIR immigration courts** — compiled from public sources with
**per-field citations**. Conflicting source values are preserved and flagged (`agreement:
"conflict"`), never silently resolved. Values from all-rights-reserved sources are
**withheld** and appear only as attributed link-outs.

- `*.json` — canonical records: every field carries its sources, dates, and agreement signal.
- `*.csv` — flat convenience cut (suggested-primary values + agreement + source count).
- `tx/` — the Texas output-filter cut (same shape; the national files are the registry).
- `sources.json` — what fed this release: source list, licenses, vintages, artifact hashes.
- `CHANGELOG.md` — what changed since the previous release.

County FIPS (5-digit, string) ships on every record. GeoJSON with centroids is planned;
records are join-ready against Census county geographies today via `county.fips`.

Staleness is data: each value's `sourceAsOf` is the date the SOURCE reported it, which may
lag `captured`. Sources publish intermittently; we hold last-known-good and show its age.
