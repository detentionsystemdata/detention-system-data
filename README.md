# Detention System Data

## About
A public-good registry of **ICE detention centers and ERO field offices**, compiled
from multiple public sources. Sources may share conflicting or overlapping data. This registry treats differences as an intrinsic feature of the data and provides per-field citations to assist with your decisions about how to use the data. 

Built to be **openly shareable and reusable** with the intent of lowering the effort needed for rote tasks like gathering the data from disparate sources.

## Unreliable ⚠️ Do not rely on this dataset alone

This is an **early-stage compilation of public sources**, provided as-is. Values may be **wrong, stale, duplicated, or incomplete.** Before acting on anything here — especially any decision impacting your life or someone else's — **verify with primary sources**:

- **Finding a person:** ICE's Online Detainee Locator — https://locator.ice.gov
- **A facility's official page:** https://www.ice.gov/detention-facilities
- **Immigration courts:** https://www.justice.gov/eoir (or call the EOIR hotline, 1-800-898-7180)
- **The sources and dates cited on each record**

**Timeliness:** Check how old a data point is before trusting it.

## Intended Use
**Not for one specific user or kind of user:** This project is offered as a general resource without one group or audience in mind. Uses of this presentation of public data are not the responsibility of this project.

**Not Editorial:** This project isn't asserting a perspective or advice. It compiles data from public sources and shows where each value came from. 

**Not Advice:** It is not legal advice.

**Not checked at a granular level:** In the aim of quick dissemmination, sources are provided and data is randomly spot checked and checked via slicing and aggregation from different angles. When possible, data is sense-checked by people experienced in this area. The project aspires to rely more on quality of injection and data connection than on depth of confirmation of each data point.

**Not meant to be your only source:** The source data can be wrong. The data can become wrong on its way into this registry. You are responsible for how you use the information. It is provided in full so you can download and use it yourself.

## Known limitations as of July 2026

- Possible duplicate records. Cross-source matching is heuristic (same ZIP + name
  overlap). A facility may appear more than once. Some merges may be wrong.
- The UWCHR base file is dated **2025-01-31** — attributes from it may be outdated.
- Field-office assignments disagree between sources in South Texas (the Harlingen
  carve-out)
- `immigrationCourt` values are **same-ZIP co-location inferences**, not jurisdiction.
- Populations/statistics come from the most recent ICE workbook (**as of 2026-04-09**);
  ICE publishes intermittently.
- No coordinates/GeoJSON yet (county FIPS ships on every record).

## Design principle: welcoming the data's quirks, gaps and contradictions

This compilation doesn't force sources to fit a particular schema, cadence, or delivery assumptions. The goal is to respectfully hold the shape, completeness, and license each source brings, and indicate the connections between the data sets to aid in your use of the data without dictating what that use will be.

Partial records, different values for the same timeline, different names, and other quirks that break other data repositories are given room to differ.

## Status (2026-07-05)
- Architecture decided
- Licensing: first version complete
- Distribution decided: git flat-files + Zenodo DOI
- Code: **live on real data** — four sources ingested (UWCHR facilities + AORs; ICE.gov roster +
  detail pages; EOIR court list + co-location hints; ICE FYTD statistics workbook — populations,
  ALOS, inspections)

## Key decisions
- **National data model, Texas output-filter** (never drop non-TX rows at ingest, since people detained in TX may be transferred out of state).
- **Union of sources + derived convergence/conflict signal** — agreement shown
  confidently, disagreement flagged and shown.
- **AI can be used** for straightforward, A-->B-->C style tasks.
- **Per-field provenance** carrying source + date **+ license/redistribution status**,
  so the build step republishes public-domain values and link-outs the rest.
- **Facts only** — visiting / advocacy / how-to-engage content lives in consuming apps.

## Contact

- **Data corrections:** open an issue or email **detentionsystemdata@gmail.com** — please
  include the record ID and a link to the public source that shows the correct value
- **Security issues:** privately, per [SECURITY.md](SECURITY.md)
