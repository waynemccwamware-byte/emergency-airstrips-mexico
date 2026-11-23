// Planning Emergency Airstrips in Mexico — copied 23-Nov-2026 from Mexican Airstrips for your EFB and Sim (airfield-kml-builder repo,
// netlify/functions/osm.js, v0.94); keep the two in step. Original notes:
// Mexican Airstrips for your EFB and Sim (formerly Airfield KML Builder) — OpenStreetMap aeroway features near a point.
//
// v0.10 (14-Nov-2026): the OSM main API (api.openstreetmap.org/api/0.6/map) first: one small box per airfield
// (about 3 × 3 km), filtered here to aeroway features and returned in Overpass "out geom" shape. Overpass
// servers are the fallback; on 14-Nov-2026 overpass-api.de answered 406 and the mirrors timed out.
// Netlify's CDN caches each airfield's answer for a week, so each airfield costs OSM one request a week at most.
// No npm packages (App Conventions §1). Data © OpenStreetMap contributors, ODbL.
//
// GET /.netlify/functions/osm?lat=26.25852&lon=-112.49787   (rounded to 5 decimals = the cache key)
// v0.81 GET ...&veg=1&km=2.5 → what X-Plane vegetation must stay off, within km of the point (0.5–3.5):
//      { roads: [[[lat,lon],…],…], tracks: […], buildings: [[[lat,lon],…],…], towns: [[[lat,lon],…],…] }
//      roads = highway ways (streets and roads), tracks = highway track/path/footway/bridleway/cycleway/steps,
//      buildings = building ways, towns = landuse residential/commercial/industrial/retail ways.

const UA = 'GeezerGeekPilot-AirfieldKML/0.10 (+https://airfield-kml-builder.netlify.app)';
const AEROWAY = /^(runway|taxiway|taxilane|apron|hangar|aerodrome|stopway)$/;
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

const json = (code, obj, cache) => ({
  statusCode: code,
  headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cache ? {
    'Cache-Control': 'public, max-age=3600',
    'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=604800',
    'Netlify-Vary': 'query=lat|lon|veg|km|v',
  } : { 'Cache-Control': 'no-store' }),
  body: JSON.stringify(obj),
});

async function timed(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, Object.assign({ signal: ctl.signal }, opts)); }
  finally { clearTimeout(t); }
}

// OSM API map call -> Overpass-like elements with geometry
async function fromOsmApi(lat, lon, ms) {
  const dLat = 0.0135, dLon = 0.0135 / Math.cos(lat * Math.PI / 180);   // ≈1.5 km each way
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map(v => v.toFixed(5)).join(',');
  const res = await timed(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, ms);
  if (!res.ok) throw new Error(`api.openstreetmap.org: HTTP ${res.status}`);
  const d = await res.json();
  const nodes = new Map(), ways = new Map(), out = [];
  for (const e of d.elements || []) {
    if (e.type === 'node') nodes.set(e.id, e);
    else if (e.type === 'way') ways.set(e.id, e);
  }
  const geom = w => w.nodes.map(id => nodes.get(id)).filter(Boolean).map(n => ({ lat: n.lat, lon: n.lon }));
  for (const e of d.elements || []) {
    const a = e.tags && e.tags.aeroway;
    if (!a || !AEROWAY.test(a)) continue;
    if (e.type === 'node') out.push({ type: 'node', id: e.id, lat: e.lat, lon: e.lon, tags: e.tags });
    else if (e.type === 'way') out.push({ type: 'way', id: e.id, tags: e.tags, geometry: geom(e) });
    else if (e.type === 'relation') out.push({ type: 'relation', id: e.id, tags: e.tags,
      members: (e.members || []).filter(m => m.type === 'way' && ways.has(m.ref)).map(m => ({ type: 'way', ref: m.ref, role: m.role, geometry: geom(ways.get(m.ref)) })) });
  }
  return { server: 'api.openstreetmap.org', elements: out };
}

// v0.81: vegetation keep-clear features (roads, buildings, towns), as plain coordinate lists
const TOWN = /^(residential|commercial|industrial|retail)$/;
const TRACK = /^(track|path|footway|bridleway|cycleway|steps)$/;
const r6 = v => Math.round(v * 1e6) / 1e6;
function vegSort(ways){
  const out = { roads: [], tracks: [], buildings: [], towns: [] };
  for (const w of ways){
    const t = w.tags || {}, g = (w.geometry || []).filter(Boolean).map(p => [r6(p.lat), r6(p.lon)]);
    if (g.length < 2) continue;
    if (t.highway) (TRACK.test(t.highway) ? out.tracks : out.roads).push(g);
    else if (t.building && g.length >= 3) out.buildings.push(g);
    else if (t.landuse && TOWN.test(t.landuse) && g.length >= 3) out.towns.push(g);
  }
  return out;
}
async function vegOsmApi(lat, lon, km, ms) {
  const dLat = km / 110.574, dLon = km / (111.32 * Math.cos(lat * Math.PI / 180));
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map(v => v.toFixed(5)).join(',');
  const res = await timed(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, ms);
  if (!res.ok) throw new Error(`api.openstreetmap.org: HTTP ${res.status}`);
  const d = await res.json(), nodes = new Map(), ways = [];
  for (const e of d.elements || []) if (e.type === 'node') nodes.set(e.id, e);
  for (const e of d.elements || []) if (e.type === 'way' && e.tags && (e.tags.highway || e.tags.building || e.tags.landuse))
    ways.push({ tags: e.tags, geometry: e.nodes.map(id => nodes.get(id)).filter(Boolean).map(n => ({ lat: n.lat, lon: n.lon })) });
  return Object.assign({ server: 'api.openstreetmap.org' }, vegSort(ways));
}
async function vegOverpass(lat, lon, km, url, ms) {
  const m = Math.round(km * 1000);
  const query = `[out:json][timeout:20];(way(around:${m},${lat.toFixed(5)},${lon.toFixed(5)})[highway];way(around:${m},${lat.toFixed(5)},${lon.toFixed(5)})[building];way(around:${m},${lat.toFixed(5)},${lon.toFixed(5)})[landuse~"^(residential|commercial|industrial|retail)$"];);out geom;`;
  const res = await timed(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: '*/*', 'User-Agent': UA }, body: 'data=' + encodeURIComponent(query) }, ms);
  const host = new URL(url).host;
  if (!res.ok) throw new Error(`${host}: HTTP ${res.status}`);
  const d = await res.json();
  return Object.assign({ server: host }, vegSort((d.elements || []).filter(e => e.type === 'way')));
}

async function fromOverpass(lat, lon, url, ms) {
  const query = `[out:json][timeout:20];nwr(around:2500,${lat.toFixed(5)},${lon.toFixed(5)})[aeroway~"^(runway|taxiway|taxilane|apron|hangar|aerodrome|stopway)$"];out geom;`;
  const res = await timed(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: '*/*', 'User-Agent': UA }, body: 'data=' + encodeURIComponent(query) }, ms);
  const host = new URL(url).host;
  if (!res.ok) throw new Error(`${host}: HTTP ${res.status}`);
  const d = await res.json();
  if (d.remark && /error|timeout|runtime/i.test(d.remark)) throw new Error(`${host}: ${d.remark.slice(0, 80)}`);
  return { server: host, elements: d.elements || [] };
}

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  const lat = Number(q.lat), lon = Number(q.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json(400, { error: 'lat and lon required' });
  const started = Date.now(), errs = [];
  const left = () => 9000 - (Date.now() - started);       // stay inside Netlify's function time limit
  if (q.veg){
    const km = Math.max(0.5, Math.min(3.5, parseFloat(q.km) || 2.5));
    try { return json(200, Object.assign({ fetched: new Date().toISOString() }, await vegOsmApi(lat, lon, km, Math.min(6000, left()))), true); }
    catch (e) { errs.push(e.name === 'AbortError' ? 'api.openstreetmap.org: timed out' : e.message); }
    for (const url of OVERPASS) {
      if (left() < 1500) break;
      try { return json(200, Object.assign({ fetched: new Date().toISOString() }, await vegOverpass(lat, lon, km, url, left())), true); }
      catch (e) { errs.push(e.name === 'AbortError' ? `${new URL(url).host}: timed out` : e.message); }
    }
    return json(502, { error: errs.join('; ') || 'no answer' });
  }
  try { return json(200, Object.assign({ fetched: new Date().toISOString() }, await fromOsmApi(lat, lon, Math.min(6000, left()))), true); }
  catch (e) { errs.push(e.name === 'AbortError' ? 'api.openstreetmap.org: timed out' : e.message); }
  for (const url of OVERPASS) {
    if (left() < 1500) break;
    try { return json(200, Object.assign({ fetched: new Date().toISOString() }, await fromOverpass(lat, lon, url, left())), true); }
    catch (e) { errs.push(e.name === 'AbortError' ? `${new URL(url).host}: timed out` : e.message); }
  }
  return json(502, { error: errs.join('; ') || 'no answer' });
};
