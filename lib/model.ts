// Typed data model for the registry: per-field provenance (every value carries its
// sources, dates, and license status), union of source values with a derived agreement
// signal, and license-aware publishing (all-rights-reserved values are withheld and
// replaced by attributed link-outs).

export type License = "green" | "amber" | "red";
export type Agreement = "single" | "converged" | "conflict";
export type Certainty =
  | "confirmed" | "plausible" | "unverified"   // curated
  | "verified" | "inferred" | "needs-review";  // pipeline / AI-proposed

/** One source's assertion of one value — the unit of provenance. */
export interface Citation {
  source: string;          // manifest key, e.g. "ddp", "ice-biweekly"
  value: unknown;          // the source's value (normalized for display)
  raw?: unknown;           // verbatim, pre-normalization
  license: License;        // from the policy register
  weight: number;          // source rating (tuned in action) → suggested primary
  sourceAsOf?: string;     // date the FACT refers to
  captured?: string;       // date WE fetched it
  url?: string;            // upstream record (used for red link-outs)
}

/** A resolved field: union of citations + derived signals. Never a bare value. */
export interface Field {
  values: Citation[];
  agreement: Agreement;
  certainty: Certainty;
  suggestedPrimary: unknown | null;   // null = withheld (all sources red) → link-out
  suggestedPrimarySource: string | null;
  withheld: boolean;                  // true = no publishable value; show attributed link-out
}

export interface NameVariant {
  value: string;
  nameType: "official-dhs" | "common-social" | "operator" | "dba" | "former" | string;
  lang?: "en" | "es";
  source: string;
  license: License;
  certainty: Certainty;
}

/** County mapping — 5-digit FIPS join keys for geographic matching. */
export interface CountyRef {
  fips: string[];          // 5-digit GEOID strings (leading zeros significant)
  names: string[];         // "Cameron County, TX"
  agreement: Agreement;    // do sources agree on the location?
  resolved: boolean;
  basis: "address" | "aor" | "none";
}

export interface Facility {
  canonicalId: string;
  kind: "detention" | "field-office" | "sub-office" | "check-in" | string;
  names: NameVariant[];
  nameAgreement: Agreement;
  suggestedPrimaryName: string;
  county: CountyRef;       // for field offices this is the AOR county set
  fields: Record<string, Field>;   // address, adp, operator, avgLengthOfStay, capacity, …
  sourceRecordIds: string[];       // provenance back to raw rows (§3)
}
