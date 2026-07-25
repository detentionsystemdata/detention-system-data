// Generates a self-contained, noindex review page for internal quality control: every
// source's value per facility side by side, agreement flags, provenance and staleness,
// county mapping, spot-checks, and automatic sanity checks. Not a public artifact.
// Run:  npm run review   (writes _data/facility-review.html; FACILITY_REVIEW_OUT mirrors it)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconcile } from "../lib/reconcile.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { generatedAt, manifest, facilities: allFacilities } = reconcile();
// Latest release changelog — surfaced on the page so members can review the diff (data-standards.md).
let relTag = "", relChangelog = "";
try {
  const rels = fs.readdirSync(path.join(ROOT, "releases")).filter((d) => /^\d{4}\.\d{2}\.\d{2}$/.test(d)).sort();
  relTag = rels.pop() || "";
  if (relTag) relChangelog = fs.readFileSync(path.join(ROOT, "releases", relTag, "CHANGELOG.md"), "utf8");
} catch {}
// Texas OUTPUT filter (architecture §8): keep national data in the store, show TX here.
const isTX = (f) => (f.states || []).includes("TX") || f.county.fips.some((x) => /^48/.test(x));
const facilities = allFacilities.filter(isTX);
// 'Expected' fields per kind, from the WHOLE national dataset (the TX slice is too small to
// set a stable bar): a field present on >=85% of a kind's records. Missing one on a given
// record is then a genuine, notable gap.
const COMMON = {};
for (const k of ["detention", "field-office", "immigration-court"]) {
  const recs = allFacilities.filter((f) => f.kind === k);
  if (!recs.length) continue;
  const cnt = {};
  for (const f of recs) for (const fk of Object.keys(f.fields)) if (!f.fields[fk].withheld) cnt[fk] = (cnt[fk] || 0) + 1;
  COMMON[k] = Object.keys(cnt).filter((fk) => cnt[fk] >= recs.length * 0.85);
}

// The client script uses NO backticks and NO ${...}; data is injected via __TOKEN__.
const TEMPLATE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Texas Detention System Data — internal review</title>
<style>
  :root { --ink:#1a1a1a; --muted:#5b5b5b; --line:#e6e6e6; --ok:#127a2e; --warn:#8a6d00; --bad:#b3261e; }
  * { box-sizing: border-box; }
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--ink); max-width: 1000px; margin: 0 auto; padding: 28px 20px 90px; }
  h1 { font-size: 24px; margin: 0 0 6px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 34px 0 10px; }
  h3 { margin: 0; font-size: 19px; }
  .lede { color: var(--muted); font-size: 14.5px; margin: 0 0 16px; }
  .lede a, .prov a, .withheld a, .legend summary { color: #3b6ef5; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 18px; }
  .stat { background: #f6f6f6; border: 1px solid var(--line); border-radius: 9px; padding: 8px 13px; font-size: 13.5px; } .stat b { font-size: 18px; display: block; margin-bottom: 1px; }
  #q { width: 100%; padding: 13px 15px; font-size: 16px; border: 2px solid #ccc; border-radius: 10px; } #q:focus { outline: none; border-color: #3b6ef5; }
  button { margin: 10px 8px 0 0; padding: 9px 13px; font-size: 14px; border: 1px solid #ccc; background: #fafafa; border-radius: 9px; cursor: pointer; }
  .chiprow { margin: 14px 0 0; }
  .chiplabel { font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-right: 8px; }
  .fchip { display: inline-block; cursor: pointer; border: 1px solid #ccc; background: #fafafa; border-radius: 999px; padding: 5px 13px; font-size: 14px; margin: 6px 6px 0 0; user-select: none; }
  .fchip:hover { border-color: #3b6ef5; }
  .fchip.active { background: #3b6ef5; border-color: #3b6ef5; color: #fff; }
  .fchip .n { color: var(--muted); font-size: 12.5px; } .fchip.active .n { color: #dbe6ff; }
  .stat.clickable { cursor: pointer; } .stat.clickable:hover { border-color: #3b6ef5; } .stat.active { border-color: #3b6ef5; box-shadow: 0 0 0 1px #3b6ef5 inset; }
  .legend { margin: 16px 0 4px; font-size: 14px; color: var(--muted); }
  .cardlink { margin-left: auto; font-size: 12.5px; color: #3b6ef5; text-decoration: none; }
  .gap { margin-top: 12px; font-size: 14px; color: #6b4e00; background: #fff7e6; border: 1px solid #f0d9a8; border-radius: 8px; padding: 8px 11px; }
  .legend summary { cursor: pointer; font-weight: 600; }
  .lgbody { line-height: 1.85; } .lgbody b { color: var(--ink); }
  .labellink { color:#3b6ef5; cursor:pointer; white-space:nowrap; }
  .modal { display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:100; align-items:flex-start; justify-content:center; padding:48px 18px; overflow:auto; }
  .modal.open { display:flex; }
  .modalbox { background:#fff; border:1px solid var(--line); border-radius:12px; max-width:760px; width:100%; padding:22px 26px 26px; position:relative; box-shadow:0 12px 48px rgba(0,0,0,.25); }
  .modaltitle { font-size:18px; margin:0 0 8px; }
  .modalclose { position:absolute; top:10px; right:12px; border:none; background:none; font-size:20px; line-height:1; cursor:pointer; color:var(--muted); margin:0; padding:4px 8px; }
  .modalclose:hover { color:var(--ink); }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; margin: 16px 0; }
  .row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .kind { font-size: 11.5px; background: #eef; color: #334; border-radius: 6px; padding: 2px 9px; text-transform: uppercase; letter-spacing: .05em; }
  .id { color: var(--muted); font-size: 12.5px; }
  .sub { color: var(--muted); font-size: 14.5px; margin-top: 14px; line-height: 1.6; }
  .namelist { margin-top: 6px; }
  .nameitem { padding: 5px 0; font-size: 15px; line-height: 1.55; }
  .nametype { color: var(--muted); }
  .badge { font-size: 12px; padding: 2px 9px; border-radius: 6px; margin-left: 8px; vertical-align: middle; }
  .b-converged { background:#e3f5e9; color: var(--ok); } .b-conflict { background:#fde8e6; color: var(--bad); } .b-single { background:#eee; color:#555; }
  .tablewrap { overflow-x: auto; margin-top: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 15px; }
  th, td { text-align: left; vertical-align: top; padding: 12px 12px; border-top: 1px solid var(--line); }
  th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); border-top: none; padding-bottom: 8px; }
  td:last-child, th:last-child { white-space: nowrap; }
  .fname { font-weight: 600; white-space: nowrap; padding-right: 20px; }
  .val { display: block; margin-top: 14px; font-size: 15px; } .val:first-child { margin-top: 0; }
  .val.primary { font-weight: 600; } .val.primary::after { content: " ◄ primary"; color: var(--ok); font-weight: 400; font-size: 12px; }
  .src { color: var(--muted); font-size: 13px; }
  .prov { color: var(--muted); font-size: 13px; margin: 4px 0 0; line-height: 1.65; }
  .withheld { color: var(--warn); font-style: italic; }
  .lic-red { color: var(--bad); }
  .checks div { padding: 6px 0; font-size: 15.5px; } .ok { color: var(--ok); } .bad { color: var(--bad); font-weight: 600; }
  .fine { color: var(--muted); font-size: 13px; margin-top: 10px; }
  footer { margin-top: 52px; border-top: 1px solid var(--line); padding-top: 18px; color: var(--muted); font-size: 13px; line-height: 1.75; }
  .attr { margin-top: 10px; padding: 11px 14px; background: #fff7e6; border: 1px solid #f0d9a8; border-radius: 9px; color: #6b4e00; }
</style></head><body>
<header>
  <h1>Texas Detention System Data — internal review</h1>
  <p class="lede" id="intro"></p>
  <div id="stats" class="stats"></div>
</header>
<section>
  <input id="q" placeholder="Search facilities, ZIPs, counties…" autofocus>
  <div><button onclick="reachOverview()">ICE reach — overview</button> <button onclick="randomSample()">Random spot-check</button> <button onclick="clearAll()">Show all</button></div>
  <!-- ZIP search still works: type a 5-digit ZIP to rank records by ZIP-area nearness. -->
</section>
<div id="chips"></div>
<div id="labelmodal" class="modal" onclick="if(event.target===this)closeLabels()"><div class="modalbox"><button class="modalclose" onclick="closeLabels()" aria-label="Close">✕</button><div class="modaltitle">What the labels mean</div><div class="lgbody" id="lgbody"></div></div></div>
<div id="results"></div>
<section class="checks"><h2>Automatic sanity checks</h2><div id="checks"></div>
  <p class="fine">All green = the reconcile ran coherently. Any red = look into it.</p></section>
<footer id="foot"></footer>
<script>
var FAC = __FAC__;
var MAN = __MAN__;
var BUILD = __BUILD__;
var NATIONAL = __NATIONAL__;

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function norm(s){ return (s || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().trim(); }
function lic(src){ return (MAN.sources[src] && MAN.sources[src].license) || "green"; }
function staleDays(asOf){ if(!asOf) return null; return Math.round((Date.parse(BUILD) - Date.parse(asOf)) / 86400000); }
var NAMETYPE = { "official-dhs":"official name", "official-eoir":"official name (EOIR/DOJ)", "common-social":"community name", "operator":"operator name", "dba":"d/b/a name", "former":"former name" };
// Facility-type codes (from UWCHR/ICE detention standards). Two separate dimensions:
var AGREEMENT = {
  "SPC":"ICE-owned Service Processing Center", "CDF":"private contract detention facility",
  "IGSA":"county/city jail rented via intergovernmental agreement", "DIGSA":"dedicated ICE facility via intergovernmental agreement",
  "USMS IGA":"jail space via US Marshals agreement", "USMS CDF":"US Marshals contract facility",
  "BOP":"federal Bureau of Prisons facility", "MIRP":"MIRP (repatriation program site)", "Other":"other/unclassified"
};
var FUNCTION_ = {
  "HOLD":"hold room (hours, not custody)", "HOSPITAL":"hospital", "HEALTH":"health facility",
  "JUVENILE":"juvenile facility", "STAGING":"staging site", "TRANSPORT":"transport hub",
  "AIRPORT":"airport", "POE":"port of entry", "BPS":"Border Patrol station",
  "FAMILY":"family residential center", "Other":"other/unclassified", "?":"unknown"
};
var AUTHORITY = { "DMCP":"ICE detention-management program", "JFRMU":"ICE family/juvenile unit", "BOP":"Bureau of Prisons", "OTHER":"other" };
function ordinal(n){ var s=["th","st","nd","rd"], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }
function decode(k, v){
  if (k==='agreement' && AGREEMENT[v]) return v + ' — ' + AGREEMENT[v];
  if (k==='facilityFunction' && FUNCTION_[v]) return v + ' — ' + FUNCTION_[v];
  if (k==='authorizingAuthority' && AUTHORITY[v]) return v + ' — ' + AUTHORITY[v];
  if (k==='circuit' && /^\d+$/.test(v)) return ordinal(+v) + ' federal judicial circuit';
  return v;
}
function zipOf(f){ var fl=f.fields.address; if(!fl) return null; for (var i=0;i<fl.values.length;i++){ var r=fl.values[i].raw; if(r && r.zip) return String(r.zip).slice(0,5); } return null; }
function numPrimary(f,k){ var v=f.fields[k] && f.fields[k].suggestedPrimary; var n=Number(v); return isNaN(n)?null:n; }
var AGREE = { converged:"agree", conflict:"disagree", single:"1 source" };
function typeLabel(t){ return NAMETYPE[t] || t; }
function srcName(k){ return (MAN.sources[k] && MAN.sources[k].product) || k; }
function agBadge(a){ return '<span class="badge b-' + a + '" title="' + (a==='converged'?'sources report the same value':a==='conflict'?'sources report different values':'only one source has this') + '">' + (AGREE[a] || a) + '</span>'; }

function nameList(f){
  return '<div class="namelist">' + f.names.map(function(n){
    return '<div class="nameitem"><span class="nameval">' + esc(n.value) + '</span> — <span class="nametype">' + esc(typeLabel(n.nameType))
      + '</span> <span class="src" title="' + esc(srcName(n.source)) + '">' + esc(n.source) + (lic(n.source)==='red'?' <span class="lic-red">(link-out only)</span>':'') + '</span></div>';
  }).join('') + '</div>';
}

function officialPageUrl(f){
  var keys = Object.keys(f.fields);
  for (var i=0;i<keys.length;i++){ var vs=f.fields[keys[i]].values; for (var j=0;j<vs.length;j++){ if (vs[j].source==='ice' && vs[j].url && vs[j].url.indexOf('/detention-facilities/')>=0) return vs[j].url; } }
  return null;
}
function officialLine(f){
  if (f.kind !== 'detention') return '';
  var u = officialPageUrl(f);
  return u ? '<div class="sub">Official ICE facility page (visiting, contact, mailing) — <a href="' + esc(u) + '">open \u2197</a></div>' : '';
}
function countyLine(f){
  var c = f.county;
  if(!c.resolved) return '<div class="sub bad">no county resolved — check address/ZIP</div>';
  var label = c.basis === 'aor' ? ('AOR — ' + c.fips.length + ' counties') : ('County(ies) ' + agBadge(c.agreement));
  return '<div class="sub">' + label + ': ' + c.names.map(esc).join(' · ') + '</div>';
}

function provLine(v){
  var s = staleDays(v.sourceAsOf);
  var L = lic(v.source);
  return '<div class="prov"><span class="src" title="' + esc(srcName(v.source)) + '">' + esc(v.source) + '</span>'
    + (v.sourceAsOf ? ' · as of ' + esc(v.sourceAsOf) + (s!=null?' ('+s+'d stale)':'') : '')
    + ' · ' + (L==='green'?'public-domain':('<span class="lic-'+L+'">'+L+'</span>'))
    + (v.url ? ' · <a href="' + esc(v.url) + '">source</a>' : '') + '</div>';
}

function fieldRows(f){
  var keys = Object.keys(f.fields);
  if(!keys.length) return '';
  var rows = keys.map(function(k){
    var fl = f.fields[k];
    var cells;
    if(fl.withheld){
      var red = fl.values.filter(function(v){ return lic(v.source)==='red'; })[0];
      cells = '<span class="withheld">withheld (all-rights-reserved) — '
        + (red && red.url ? '<a href="'+esc(red.url)+'">see source ('+esc(red.source)+')</a>' : 'link out') + '</span>';
    } else {
      cells = fl.values.map(function(v){
        var isPrim = (v.source === fl.suggestedPrimarySource);
        var redTag = lic(v.source)==='red' ? ' <span class="withheld">(red — not published)</span>' : '';
        return '<span class="val' + (isPrim?' primary':'') + '">' + esc(decode(k, v.value))
          + ' <span class="src" title="' + esc(srcName(v.source)) + '">' + esc(v.source) + '</span>' + redTag + '</span>' + provLine(v);
      }).join('');
    }
    return '<tr><td class="fname">' + esc(k) + '</td><td>' + cells + '</td><td>' + agBadge(fl.agreement) + '</td></tr>';
  }).join('');
  return '<div class="tablewrap"><table><tr><th>Field</th><th>Values by source</th><th>Sources agree?</th></tr>' + rows + '</table></div>';
}

function card(f){
  var fn = f.fields.facilityFunction && !f.fields.facilityFunction.withheld ? f.fields.facilityFunction.suggestedPrimary : null;
  var fnLabel = fn && FUNCTION_[fn] ? FUNCTION_[fn].split(' (')[0] : fn;
  return '<div class="card"><div class="row"><h3>' + esc(f.suggestedPrimaryName) + '</h3>'
    + '<span class="kind">' + esc(f.kind) + (fnLabel ? ' · ' + esc(fnLabel) : '') + '</span>'
    + (f.nameAgreement==='conflict' ? '<span class="badge b-conflict" title="sources give different official names">names disagree</span>' : '')
    + '<span class="id">' + esc(f.canonicalId) + '</span></div>'
    + '<div class="sub">Names' + (f.nameAgreement==='conflict' ? ' — <span class="lic-red">sources give different official names below</span>' : '') + ':</div>'
    + nameList(f)
    + countyLine(f)
    + gapLine(f)
    + officialLine(f)
    + fieldRows(f) + '</div>';
}

function render(list, note){
  document.getElementById('results').innerHTML =
    (note || '') + '<h2>Facilities (' + list.length + ')</h2>' + (list.length ? list.map(card).join('') : '<div class="sub">none match</div>');
}

function matchFac(f, q){
  var hay = [f.canonicalId, f.suggestedPrimaryName].concat(
    f.names.map(function(n){ return n.value; }),
    f.county.names,
    Object.keys(f.fields).map(function(k){ return f.fields[k].values.map(function(v){ return v.value; }).join(' '); })
  ).join(' ');
  return norm(hay).indexOf(norm(q)) >= 0;
}

function randomSample(){
  var pick = FAC.slice().sort(function(){ return 0.5 - Math.sin(Date.now() + Math.random()); }).slice(0, Math.min(3, FAC.length));
  document.getElementById('q').value = '';
  render(pick);
  VIEW = 'sample'; paintStats();
}

// ---- browse filters (chips + clickable tiles) --------------------------------
var FILT = { kind: null, dis: false, geo: false, fo: [], size: [], fn: [], agr: [], ack: [], gap: [] };
var VIEW = 'list'; // 'list' | 'sources' | 'overview' | 'sample'

function onIceList(f){ return f.sourceRecordIds.some(function(id){ return id.indexOf('ice-') === 0; }); }
function ackGroup(f){
  if (f.kind !== 'detention') return null;
  return onIceList(f) ? 'on ICE’s public list' : 'not on ICE’s public list';
}

function primaryOf(f, k){ var fl = f.fields[k]; return fl && !fl.withheld ? fl.suggestedPrimary : null; }
function fnGroup(f){
  if (f.kind !== 'detention') return null;
  var v = primaryOf(f, 'facilityFunction');
  if (!v) return 'standard detention';
  if (v === 'HOLD') return 'hold room';
  if (v === 'HOSPITAL' || v === 'HEALTH') return 'hospital / health';
  if (v === 'JUVENILE') return 'juvenile';
  if (v === 'FAMILY') return 'family';
  if (v === 'STAGING') return 'staging';
  if (v === 'TRANSPORT' || v === 'AIRPORT' || v === 'POE' || v === 'BPS') return 'transport / border';
  return 'other';
}
function agrGroup(f){
  if (f.kind !== 'detention') return null;
  var v = primaryOf(f, 'agreement');
  if (v === 'SPC') return 'ICE-owned';
  if (v === 'CDF' || v === 'USMS CDF') return 'private contract';
  if (v === 'IGSA') return 'county/city jail';
  if (v === 'DIGSA') return 'dedicated ICE (IGSA)';
  if (v === 'USMS IGA') return 'via US Marshals';
  if (v === 'BOP') return 'federal prison';
  return 'other / unknown';
}
var FIELDOFFICE = { SNA:"San Antonio", DAL:"Dallas", HOU:"Houston", ELP:"El Paso", HAR:"Harlingen", HLG:"Harlingen" };
function foGroup(f){ if (f.kind !== 'detention') return null; var v = primaryOf(f, 'fieldOffice'); return v ? (FIELDOFFICE[v] || v) : null; }
function sizeGroup(f){
  if (f.kind !== 'detention') return null;
  var fl = f.fields.adpTotal; var v = fl && !fl.withheld ? Number(fl.suggestedPrimary) : null;
  if (v == null || isNaN(v)) return 'no current count';
  if (v >= 500) return '500+ held now'; if (v >= 50) return '50–500 held now'; return 'under 50 held now';
}
function prettyKey(k){ return k.replace(/([A-Z])/g,' $1').toLowerCase().trim().replace(/\badp\b/,'ADP').replace(/\bdhs\b/,'DHS'); }
var COMMON = __COMMON__; // 'expected' fields per kind (>=85% of the national dataset)
function gapsFor(f){
  var missing = (COMMON[f.kind] || []).filter(function(fk){ return !f.fields[fk] || f.fields[fk].withheld; });
  if (f.kind === 'detention' && !f.county.resolved) missing.push('county');
  return missing;
}
function gapGroup(f){ return gapsFor(f).length ? 'has a data gap' : 'complete'; }
function gapLine(f){
  var g = gapsFor(f);
  if (!g.length) return '';
  return '<div class="gap">⚠ Missing: <b>' + g.map(function(k){ return esc(prettyKey(k)); }).join(', ') + '</b>. These were available from data sources for similar items.</div>';
}
function hasDisagreement(f){
  if (f.nameAgreement === 'conflict' || f.county.agreement === 'conflict') return true;
  return Object.keys(f.fields).some(function(k){ return f.fields[k].agreement === 'conflict'; });
}

function apply(){
  VIEW = 'list';
  var q = document.getElementById('q').value.trim();
  var list = FAC.filter(function(f){
    if (FILT.kind && f.kind !== FILT.kind) return false;
    if (FILT.dis && !hasDisagreement(f)) return false;
    if (FILT.geo && f.county.resolved) return false;
    if (FILT.fo.length && FILT.fo.indexOf(foGroup(f)) < 0) return false;
    if (FILT.size.length && FILT.size.indexOf(sizeGroup(f)) < 0) return false;
    if (FILT.fn.length && FILT.fn.indexOf(fnGroup(f)) < 0) return false;
    if (FILT.agr.length && FILT.agr.indexOf(agrGroup(f)) < 0) return false;
    if (FILT.ack.length && FILT.ack.indexOf(ackGroup(f)) < 0) return false;
    if (FILT.gap.length && FILT.gap.indexOf(gapGroup(f)) < 0) return false;
    if (q && !/^\d{5}$/.test(q) && !matchFac(f, q)) return false;
    return true;
  });
  if (/^\d{5}$/.test(q)) {
    // "What's near me" (rough): rank by ZIP closeness — exact ZIP, then same 3-digit
    // area, then same 2-digit region, then the rest. Honest proxy, not distance.
    var score = function(f){ var z = zipOf(f); if (!z) return 9;
      if (z === q) return 0; if (z.slice(0,3) === q.slice(0,3)) return 1; if (z.slice(0,2) === q.slice(0,2)) return 2; return 3; };
    list = list.filter(function(f){ return f.kind === 'detention'; })
      .sort(function(a,b){ return score(a) - score(b) || a.suggestedPrimaryName.localeCompare(b.suggestedPrimaryName); })
      .slice(0, 40);
    render(list, '<div class="card"><h3>Near ZIP ' + esc(q) + ' (approximate)</h3><div class="sub">Ranked by ZIP area (same ZIP → same 3-digit area → same region) — a rough nearness proxy, not miles. Includes hold rooms, county jails, and other less-known places a person could be.</div></div>');
    buildChips(); paintStats(); return;
  }
  render(list);
  buildChips();
  paintStats();
}
function clearAll(){ FILT = { kind: null, dis: false, geo: false, fo: [], size: [], fn: [], agr: [], ack: [], gap: [] }; document.getElementById('q').value = ''; apply(); }
function toggleGeo(){ FILT.geo = (VIEW === 'list') ? !FILT.geo : true; apply(); }
function setKind(k){ FILT.kind = (VIEW === 'list' && FILT.kind === k) ? null : k; apply(); }
function openLabels(){ document.getElementById('labelmodal').classList.add('open'); }
function closeLabels(){ document.getElementById('labelmodal').classList.remove('open'); }
function toggle(key, val){
  if (Array.isArray(FILT[key])) { var i = FILT[key].indexOf(val); if (i >= 0) FILT[key].splice(i, 1); else FILT[key].push(val); }
  else { FILT[key] = (FILT[key] === val) ? null : val; }
  apply();
}
function toggleDis(){ FILT.dis = (VIEW === 'list') ? !FILT.dis : true; apply(); }

function chipRow(label, key, groupFn, order){
  var counts = {};
  FAC.forEach(function(f){ var g = groupFn(f); if (g) counts[g] = (counts[g] || 0) + 1; });
  var keys = order ? order.filter(function(k){ return counts[k]; })
    : Object.keys(counts).sort(function(a, b){ return counts[b] - counts[a]; });
  if (!keys.length) return '';
  return '<div class="chiprow"><span class="chiplabel">' + label + '</span>' + keys.map(function(g){
    var on = FILT[key].indexOf(g) >= 0 ? ' active' : '';
    return '<span class="fchip' + on + '" data-key="' + key + '" data-val="' + esc(g) + '">' + g + ' <span class="n">' + counts[g] + '</span></span>';
  }).join('') + '</div>';
}
function buildChips(){
  document.getElementById('chips').innerHTML =
    chipRow('Field office', 'fo', foGroup)
    + chipRow('People held now', 'size', sizeGroup, ['500+ held now', '50–500 held now', 'under 50 held now', 'no current count'])
    + chipRow('What kind', 'fn', fnGroup)
    + chipRow('Who runs it', 'agr', agrGroup)
    + chipRow('Acknowledged?', 'ack', ackGroup)
    + chipRow('Completeness', 'gap', gapGroup);
}

// ---- "ICE reach" overview (civilian slice) -----------------------------------
function countBy(list, fn){ var c = {}; list.forEach(function(f){ var g = fn(f); if (g) c[g] = (c[g]||0)+1; }); return c; }
function pairsDesc(c){ return Object.keys(c).map(function(k){ return [k, c[k]]; }).sort(function(a,b){ return b[1]-a[1]; }); }
function chipsHtml(c){ return pairsDesc(c).map(function(p){ return esc(p[0]) + ' <b>' + p[1] + '</b>'; }).join(' &nbsp;·&nbsp; '); }
function reachOverview(){
  var dets2 = FAC.filter(function(f){ return f.kind === 'detention'; });
  var counties = countBy(dets2, function(f){ return f.county.names[0] || null; });
  var capSum = 0, gmSum = 0, gmN = 0;
  dets2.forEach(function(f){ var c = numPrimary(f,'capacity'); if (c) capSum += c; var g = numPrimary(f,'guaranteedMinimumBeds'); if (g) { gmSum += g; gmN++; } });
  var ack = countBy(dets2, ackGroup);
  var onN = ack['on ICE’s public list'] || 0;
  var html = '<div class="card"><h3>ICE reach in Texas — overview</h3>'
    + '<div class="sub">' + dets2.length + ' places ICE holds or processes people (of ' + NATIONAL + ' records nationwide), across ' + Object.keys(counties).length + ' counties. Everything below comes from the sources on this page; it is the Texas output slice.</div>'
    + '<div class="sub"><b>What kinds of places:</b><br>' + chipsHtml(countBy(dets2, fnGroup)) + '</div>'
    + '<div class="sub"><b>Who runs them:</b><br>' + chipsHtml(countBy(dets2, agrGroup)) + '</div>'
    + '<div class="sub"><b>Acknowledgment:</b> ICE’s public website lists <b>' + onN + '</b> of these ' + dets2.length + ' (' + Math.round(100*onN/(dets2.length||1)) + '%). The rest appear in FOIA records but not on ICE’s list.</div>'
    + '<div class="sub"><b>Scale:</b> listed bed capacity sums to <b>' + capSum.toLocaleString() + '</b>' + (gmN ? '; <b>' + gmSum.toLocaleString() + '</b> beds are contractually guaranteed minimums across ' + gmN + ' facilities (paid for whether filled or not)' : '') + '.</div>'
    + '<div class="sub"><b>Counties with the most facilities:</b><br>' + chipsHtml(Object.fromEntries(pairsDesc(counties).slice(0,12))) + '</div>'
    + '</div>';
  document.getElementById('q').value = '';
  document.getElementById('results').innerHTML = html;
  VIEW = 'overview'; paintStats();
}

document.getElementById('q').addEventListener('input', function(){ apply(); });
document.getElementById('chips').addEventListener('click', function(e){
  var c = e.target.closest('.fchip');
  if (c) toggle(c.getAttribute('data-key'), c.getAttribute('data-val'));
});
document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeLabels(); });

// ---- stats + sanity checks --------------------------------------------------
function conflictCount(){
  var n = 0;
  FAC.forEach(function(f){
    if(f.nameAgreement==='conflict') n++;
    if(f.county.agreement==='conflict') n++;
    Object.keys(f.fields).forEach(function(k){ if(f.fields[k].agreement==='conflict') n++; });
  });
  return n;
}
var dets = FAC.filter(function(f){ return f.kind==='detention'; });
var offices = FAC.filter(function(f){ return f.kind==='field-office'; });
var present = {}; FAC.forEach(function(f){ f.names.forEach(function(n){ present[n.source]=1; }); Object.keys(f.fields).forEach(function(k){ f.fields[k].values.forEach(function(v){ present[v.source]=1; }); }); });
function paintStats(){
  var tile = function(n, l, on, click){ return '<span class="stat clickable' + (on ? ' active' : '') + '" onclick="' + click + '"><b>' + n + '</b> ' + l + '</span>'; };
  var courts = FAC.filter(function(f){ return f.kind === 'immigration-court'; });
  var L = VIEW === 'list';
  document.getElementById('stats').innerHTML = [
    tile(dets.length, 'detention facilities', L && FILT.kind === 'detention', "setKind('detention')"),
    tile(offices.length, 'field offices', L && FILT.kind === 'field-office', "setKind('field-office')"),
    tile(courts.length, 'immigration courts', L && FILT.kind === 'immigration-court', "setKind('immigration-court')"),
    tile(Object.keys(present).length, 'sources', VIEW === 'sources', 'showSources()'),
    tile(FAC.filter(hasDisagreement).length, 'records disagree', L && FILT.dis, 'toggleDis()'),
    tile(FAC.filter(function(f){ return !f.county.resolved; }).length, 'geo-unresolved', L && FILT.geo, 'toggleGeo()')
  ].join('');
}

// Sources view: one card per active source — what it is, license, vintage, link, coverage.
function showSources(){
  var keys = Object.keys(present).sort();
  var html = '<h2>Sources (' + keys.length + ' active)</h2>' + keys.map(function(k){
    var m = MAN.sources[k] || {};
    var n = FAC.filter(function(f){
      return f.sourceRecordIds.some(function(id){ return id.indexOf(k + '-') === 0 || id.indexOf(k) === 0; }) ||
        Object.keys(f.fields).some(function(fk){ return f.fields[fk].values.some(function(v){ return v.source === k; }); });
    }).length;
    return '<div class="card"><div class="row"><h3>' + esc(k) + '</h3>'
      + '<span class="kind">' + esc(m.license || '') + '</span>'
      + (m.source_url ? '<a class="cardlink" href="' + esc(m.source_url) + '">open source ↗</a>' : '') + '</div>'
      + '<div class="sub">' + esc(m.product || '') + '</div>'
      + '<div class="sub">Vintage: ' + esc(m.vintage || '—') + ' · appears on ' + n + ' of ' + FAC.length + ' records shown' + (m.note ? '<br>' + esc(m.note) : '') + '</div>'
      + '</div>';
  }).join('');
  document.getElementById('q').value = '';
  document.getElementById('results').innerHTML = html;
  VIEW = 'sources'; paintStats();
}
document.getElementById('intro').innerHTML = "TX facilities (" + FAC.length + " of " + NATIONAL + " nationwide). Public sources side by side. <a class='labellink' onclick='openLabels()'>What the labels mean</a>";

function checks(){
  var noRedPublished = true;
  FAC.forEach(function(f){ Object.keys(f.fields).forEach(function(k){ var p = f.fields[k].suggestedPrimarySource; if(p && lic(p)==='red') noRedPublished = false; }); });
  var detResolved = dets.filter(function(f){ return f.county.resolved; }).length;
  var rate = dets.length ? detResolved / dets.length : 1;
  var t = [
    ['Loaded a plausible number of TX detention facilities (≥ 50)', dets.length >= 50],
    ['Every facility has a name', FAC.every(function(f){ return f.names.length > 0; })],
    ['≥ 90% of TX detention facilities resolve to a county (' + detResolved + '/' + dets.length + ')', rate >= 0.9],
    ['Resolved detention counties are all Texas (48xxx) FIPS', dets.every(function(f){ return f.county.fips.every(function(x){ return /^48\\d{3}$/.test(x); }); })],
    ['No red-license value is published as the primary', noRedPublished],
    ['Port Isabel present', FAC.some(function(f){ return /port isabel/i.test(f.suggestedPrimaryName); })],
    ['TX field offices carry an AOR county set', offices.length > 0 && offices.every(function(f){ return f.county.fips.length > 0; })],
    ['TX immigration courts loaded (≥ 5)', FAC.filter(function(f){ return f.kind === 'immigration-court'; }).length >= 5],
    ['Current populations present (≥ 15 TX facilities carry adpTotal)', dets.filter(function(f){ return f.fields.adpTotal; }).length >= 15],
    ['Port Isabel carries a co-located court hint', FAC.some(function(f){ return /port isabel/i.test(f.suggestedPrimaryName) && f.fields.immigrationCourt; })]
  ];
  return t.map(function(x){ return '<div class="' + (x[1]?'ok':'bad') + '">' + (x[1]?'\\u2713 ':'\\u2717 ') + x[0] + '</div>'; }).join('');
}
document.getElementById('checks').innerHTML = checks();

document.getElementById('lgbody').innerHTML =
  '<b>Sources</b> (the short codes; click the “sources” tile above for details)<br>'
  + Object.keys(present).sort().map(function(k){ return '<b>' + k + '</b> = ' + esc(srcName(k)); }).join('<br>')
  + '<br><br><b>“Sources agree?”</b><br>'
  + '<span class="badge b-converged">agree</span> every source that reports this field gives the same value &nbsp; '
  + '<span class="badge b-conflict">disagree</span> sources differ — all values shown, flagged &nbsp; '
  + '<span class="badge b-single">1 source</span> only one source reports it'
  + '<br><br><b>Facility-type codes</b> — two separate dimensions, kept apart on purpose<br>'
  + '<b>agreement</b> (who runs it / under what contract): '
  + Object.keys(AGREEMENT).map(function(k){ return '<b>' + k + '</b> ' + AGREEMENT[k]; }).join(' · ')
  + '<br><b>facilityFunction</b> (what happens to people there): '
  + Object.keys(FUNCTION_).map(function(k){ return '<b>' + k + '</b> ' + FUNCTION_[k]; }).join(' · ')
  + '<br><b>holdsOver72h</b> = whether people are held beyond 72 hours (custody vs. a short-term stop)'
  + '<br><br><b>Deeper fields</b><br>'
  + '<b>circuit</b> = which federal appeals circuit governs cases there (case law differs by circuit) &nbsp;·&nbsp; '
  + '<b>docket</b> = the ICE sub-office managing the facility (finer than the field office) &nbsp;·&nbsp; '
  + '<b>fieldOffice</b> = ERO field-office code (SNA San Antonio · DAL Dallas · HOU Houston · ELP El Paso · HAR Harlingen) &nbsp;·&nbsp; '
  + '<b>guaranteedMinimumBeds</b> = beds ICE pays for whether filled or not (contract quota) &nbsp;·&nbsp; '
  + '<b>firstUsed / lastUsed</b> = usage history (active vs dormant) &nbsp;·&nbsp; '
  + '<b>underDetentionStandards</b> = covered by ICE’s detention-standards program &nbsp;·&nbsp; '
  + '<b>phone</b> = the facility’s detainee-information line (from ice.gov) &nbsp;·&nbsp; '
  + '<b>immigrationCourt</b> = a court at the same ZIP as the facility (a co-location hint, our labeled derivation — NOT court jurisdiction, which is not published anywhere we ingest).'
  + '<br><br><b>Other words</b><br>'
  + '<b>◄ primary</b> = the value the release publishes (highest-weighted source wins the suggestion; all values kept) &nbsp;·&nbsp; '
  + '<b>“Nd stale”</b> = days since the source last updated that fact (older = check it) &nbsp;·&nbsp; '
  + '<b>public-domain</b> = free to republish; amber = published with attribution pending reuse confirmation'
  + '<br><br><b>Names look inconsistent?</b> Intentional — names are shown <b>verbatim, exactly as each source writes them</b> (ALL CAPS and abbreviations are the sources’ own).';

var srcLines = Object.keys(present).sort().map(function(k){ var s = MAN.sources[k] || {}; return k + ' — ' + esc(s.product||k) + ' · ' + (s.license||'') + ' · weight ' + (s.weight||'—') + ' · ' + esc(s.vintage||''); }).join('<br>');
var attrs = Object.keys(present).map(function(k){ return (MAN.sources[k]||{}).attribution_required; }).filter(Boolean);
document.getElementById('foot').innerHTML = 'Built ' + esc(BUILD) + '<br>Sources —<br>' + srcLines + (attrs.length ? '<div class="attr">' + attrs.map(esc).join('<br>') + '</div>' : '');

apply();
</script></body></html>`;

// `<` is escaped to < so remote-sourced strings (facility names, addresses) can never
// contain a working `</script>` and break out of the inline script context.
const inject = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const escText = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const html = TEMPLATE.replace("__RELTAG__", () => escText(relTag || "none yet"))
  .replace("__RELCHANGELOG__", () => escText(relChangelog || "No release built yet."))
  .replace("__FAC__", () => inject(facilities))
  .replace("__MAN__", () => inject(manifest))
  .replace("__BUILD__", () => inject(generatedAt))
  .replace("__NATIONAL__", () => inject(allFacilities.length))
  .replace("__COMMON__", () => inject(COMMON));

const outDir = path.join(ROOT, "_data");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "facility-review.html");
fs.writeFileSync(outPath, html);
console.log(`✓ Wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
console.log(`  ${facilities.length} TX records shown (of ${allFacilities.length} national).`);

// Optional mirror to a private deploy dir (set FACILITY_REVIEW_OUT to an index.html path).
const deploy = process.env.FACILITY_REVIEW_OUT;
if (deploy) {
  fs.mkdirSync(path.dirname(deploy), { recursive: true });
  fs.writeFileSync(deploy, html);
  console.log(`✓ Mirrored to ${deploy}`);
}
