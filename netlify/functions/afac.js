// Planning Emergency Airstrips in Mexico — AFAC aerodromes list as JSON. Copied 23-Nov-2026 from Mexican Airstrips for your EFB and Sim (airfield-kml-builder repo, netlify/functions/afac.js); keep the two in step.
//
// Source: AFAC (Agencia Federal de Aviación Civil, Mexico) public spreadsheet "Aeródromos y helipuertos",
// published on gob.mx. The same file airports.robrc.net uses as its principal source (credit to robrc.net
// for showing the way). The browser can't read gob.mx directly (no CORS), so this function fetches the
// XLSX, unzips it with Node's built-in zlib (no npm packages: App Conventions §1, no build step) and
// returns one compact record per row.
//
// AFAC_URL (fallback since v0.60, see latestUrl): the edition is in the file name (pub-290726 = 29-Jul-2026). When AFAC posts a new edition the
// attachment number changes too; latestUrl() reads it from AFAC's page (or set the AFAC_XLSX_URL environment variable in
// Netlify). There is no stable "latest" link that we know of (checked 14-Nov-2026).

const zlib = require('zlib');

const AFAC_URL = process.env.AFAC_XLSX_URL ||
  'https://www.gob.mx/cms/uploads/attachment/file/1093964/aerodromo-helipuertos-pub-290726.xlsx';

let lastHeaders = [];   // v0.60: header texts of the AFAC sheet, listed in source.columns (to see what AFAC does and doesn't publish)
// v0.60: AFAC's page links the newest edition; read the link from it so new editions are picked up without a code
// change (Wayne found the 28-Sep-2026 edition while the app still read 29-Jul-2026). AFAC_URL is the fallback.
const AFAC_PAGE = 'https://www.gob.mx/afac/acciones-y-programas/base-de-datos-de-aerodromos-y-helipuertos';
async function latestUrl() {
  if (process.env.AFAC_XLSX_URL) return AFAC_URL;
  try {
    const res = await fetch(AFAC_PAGE, { headers: { 'User-Agent': 'Mozilla/5.0 (GeezerGeekPilot-EmergencyAirstrips)', 'Accept': 'text/html' } });
    if (!res.ok) return AFAC_URL;
    const html = await res.text();
    const links = [...html.matchAll(/(?:https:\/\/www\.gob\.mx)?\/cms\/uploads\/attachment\/file\/\d+\/[^"'\s<>]*?\.xlsx/gi)].map(m => m[0])
      .filter(u => /aerodromo/i.test(u));
    if (!links.length) return AFAC_URL;
    // newest by the pub-DDMMYY date in the file name
    const key = u => { const m = u.match(/pub-(\d{2})(\d{2})(\d{2})/); return m ? m[3] + m[2] + m[1] : ''; };
    links.sort((a, b) => key(b).localeCompare(key(a)));
    const u = links[0];
    return u.startsWith('http') ? u : 'https://www.gob.mx' + u;
  } catch (e) { return AFAC_URL; }
}
let cache = null;          // { at, body } — kept while the function instance stays warm
const TTL_MS = 6 * 3600 * 1000;

// ---- minimal XLSX (zip) reader -------------------------------------------------------------
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    files[name] = { method, csize, off };
    p += 46 + nl + el + cl;
  }
  return (name) => {
    const f = files[name];
    if (!f) return null;
    const lnl = buf.readUInt16LE(f.off + 26), lel = buf.readUInt16LE(f.off + 28);
    const data = buf.slice(f.off + 30 + lnl + lel, f.off + 30 + lnl + lel + f.csize);
    return (f.method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
  };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));

function readSheet(get) {
  const ssXml = get('xl/sharedStrings.xml') || '';
  const strings = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m =>
    unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  const sheet = get('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('sheet1 missing');
  const rows = [];
  for (const rm of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = {};
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, col, attrs, inner = ''] = cm;
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val;
      if (/t="s"/.test(attrs)) val = strings[+v];
      else if (/t="inlineStr"/.test(attrs)) val = unxml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
      else val = v !== undefined ? unxml(v) : '';
      row[col] = (val ?? '').toString().trim();
    }
    rows.push(row);
  }
  return rows;
}

// ---- AFAC rows -> records ------------------------------------------------------------------
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const excelDate = (v) => {
  const n = Number(v);
  if (!v || !isFinite(n) || n < 20000 || n > 80000) return v || '';
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
};
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };

function toRecords(rows) {
  const hi = rows.findIndex(r => Object.values(r).some(v => norm(v) === 'DESIGNADOR'));
  if (hi < 0) throw new Error('header row with DESIGNADOR not found');
  // Column letters by header text. "NOMBRE" appears twice: aerodrome name, then owner (DATOS DEL PROPIETARIO).
  const cols = {};
  const order = Object.keys(rows[hi]).sort((a, b) => a.length - b.length || a.localeCompare(b));
  for (const c of order) {
    const h = norm(rows[hi][c]);
    if (h === 'NOMBRE') cols[cols.name ? 'owner' : 'name'] = c;
    else cols[h] = c;
  }
  lastHeaders = order.map(c => String(rows[hi][c] || '').trim()).filter(Boolean);
  const g = (r, key) => (cols[key] && r[cols[key]]) || '';
  const pick = (r, ...keys) => { for (const k of keys) { const v = g(r, k); if (v) return v; } return ''; };
  const latKeys = Object.keys(cols).filter(k => k.startsWith('LATITUD'));
  const lonKeys = Object.keys(cols).filter(k => k.startsWith('LONGITUD') && !k.includes('PISTA'));
  const dms = (r, keys) => {
    const d = num(r[cols[keys.find(k => k.endsWith('°'))]]);
    const m = num(r[cols[keys.find(k => /[^']'$/.test(k))]]) || 0;
    const s = num(r[cols[keys.find(k => k.endsWith("''"))]]) || 0;
    return d === null ? null : d + m / 60 + s / 3600;
  };
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const des = g(r, 'DESIGNADOR').replace(/\s+/g, ' ');
    const name = g(r, 'name').replace(/\s+/g, ' ');
    if (!des && !name) continue;
    const lat = dms(r, latKeys);
    const lonAbs = dms(r, lonKeys);
    out.push({
      file: g(r, 'NO. DE EXPEDIENTE'),
      type: g(r, 'TIPO AERODROMO'),
      des, name,
      state: g(r, 'ESTADO'),
      muni: g(r, 'MUNICIPIO'),
      ops: g(r, 'TIPO DE OPERACION'),
      svc: g(r, 'TIPO DE SERVICIO'),
      cls: g(r, 'CLASIFICACION'),
      ref: g(r, 'CLAVE DE REFERENCIA'),
      owner: g(r, 'owner').replace(/\s+/g, ' '),
      elev_m: num(g(r, 'ELEV (M)')),
      datum: g(r, 'SISTEMA'),
      lat: lat === null ? null : +lat.toFixed(6),
      lon: lonAbs === null ? null : +(-Math.abs(lonAbs)).toFixed(6),   // Mexico is west longitude
      rwy: [pick(r, 'ORIENTACION 1A'), pick(r, 'ORIENTACION 2A')].filter(Boolean),
      len_m: num(g(r, 'LONGITUD DE PISTA A')),
      wid_m: num(g(r, 'ANCHO DE PISTA A')),
      surf: g(r, 'TIPO DE SUPERFICIE A'),
      issued: excelDate(g(r, 'FECHA DE EXPEDICION')),
      expires: excelDate(g(r, 'FECHA DE VENCIMIENTO')),
      current: g(r, '¿VIGENTE?'),
      status: g(r, 'SITUACION'),
      coord_apt: g(r, 'AEROPUERTO DE CORDINACION'),
    });
  }
  return out;
}

const editionFromUrl = (u) => {
  const m = u.match(/pub-(\d{2})(\d{2})(\d{2})/);
  if (!m) return '';
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m[2] - 1];
  return `${m[1]}-${mon}-20${m[3]}`;
};

// Heliports, helidecks and ship heliports have no runway; left out unless ?all=1.
const NO_RUNWAY = /^(HELIPUERTO|BARCO-HELIPUERTO|HELIPLATAFORMA|PLATAFORMA-HELIPUERTO)$/;

exports.handler = async (event) => {
  const all = event && event.queryStringParameters && event.queryStringParameters.all === '1';
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      const url = await latestUrl();
      const res = await fetch(url, { headers: { 'User-Agent': 'GeezerGeekPilot-AirfieldKML/0.1' } });
      if (!res.ok) throw new Error(`AFAC download failed: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const records = toRecords(readSheet(unzip(buf)));
      const source = { name: 'AFAC — Aeródromos y helipuertos (gob.mx)', url, edition: editionFromUrl(url), page: AFAC_PAGE, found: url !== AFAC_URL,
                       fetched: new Date().toISOString(), rows: records.length, columns: lastHeaders };
      const runways = records.filter(r => !NO_RUNWAY.test(norm(r.type)));
      cache = {
        at: Date.now(),
        all: JSON.stringify({ source: { ...source, count: records.length }, records }),
        body: JSON.stringify({ source: { ...source, count: runways.length }, records: runways }),
      };
    }
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=86400',
        'Netlify-Vary': 'query=all',
      },
      body: all ? cache.all : cache.body,
    };
  } catch (err) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ error: String(err && err.message || err) }) };
  }
};

// exported for local tests
exports._parse = (buf) => toRecords(readSheet(unzip(buf)));
