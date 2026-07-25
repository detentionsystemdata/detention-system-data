# Data standards & release process

_What this project normalizes, what it never touches, and the review gate every release
passes through. Last updated 2026-07-05._

## What we publish vs. what we keep

- **Raw source values are always preserved** (per-record `sources[].value`, plus raw rows in
  `data/sources/`). Everything below governs the *published/display* layer only — nothing is
  ever normalized destructively.
- **Red-licensed values never ship** — enforced by assertions in the release builder.

## Normalizations we DO (mechanical, uniform, documented)

| What | Rule |
|---|---|
| ZIPs | 5-digit, zero-padded strings |
| County FIPS | 5-digit GEOID **strings** (leading zeros significant) |
| Dates | ISO `YYYY-MM-DD`; Excel serials converted; two dates per fact (`sourceAsOf` ≠ `captured`) |
| Numbers | Publish as JSON numbers, rounded to 1 decimal where sources give floats |
| Whitespace | Trimmed; internal runs collapsed for comparison only |

## What we do NOT do

- **Names are published verbatim, exactly as each source writes them.** Capitalization,
  abbreviations, and inconsistencies are the sources' own. A curated display-label layer
  (with verbatim values still preserved) may be added later.
- No inferred facts. Derivations (entity matches, co-location court hints, suggested
  primaries, convergence flags) follow **written rules**, are **labeled** (`certainty:
  inferred`), and are reversible by re-running the pipeline. Ambiguous cases are flagged
  for humans, never forced.

## When releases happen

There is **no fixed schedule.** A release is built when sources have meaningfully changed
and the review below has been completed — not on a calendar. Sources publish at different
and sometimes irregular rates, so releases are irregular by design; each record's
`sourceAsOf` dates show how current its facts are.

## Review before a release (the intended process)

1. Re-run all ingests; regenerate the review page. Automatic sanity checks should be green.
2. **Read the CHANGELOG diff.** Each added/removed/changed record should be explainable by a
   source change; anything unexplainable is worth investigating before shipping.
3. **Spot-check a handful of records** against their sources (review page → Random spot-check).
4. Confirm the licensing register (`_policies/source-data-use.md`) still reflects the sources.
5. Tag + push. (Immutable archiving via a DOI is planned, not yet wired.)

## Member review loop (spot-check · notify · thorough review)

Reviewers use a private, access-controlled review page:

- **Spot-check:** the *Random spot-check* button; compare a card's values against its
  linked sources.
- **Thorough review:** the *Latest release* panel on the review page shows the current
  release's CHANGELOG (what changed and why it should make sense); browse chips + search
  for anything suspicious.
- **Report a correction:** open an issue or email the project mailbox with the record ID
  and a public source showing the correct value; corrections are made at the source-record layer.
- **Get notified:** GitHub **Watch → Custom → Releases**, or the releases feed
  (`releases.atom`) for notification without an account.
