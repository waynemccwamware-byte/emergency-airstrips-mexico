// Planning Emergency Airstrips in Mexico — copied 23-Nov-2026 from Mexican Airstrips for your EFB and Sim (airfield-kml-builder repo,
// netlify/functions/pack.js, v0.94); limits raised for route packs (300,000-character payload, 8 MB unzipped; v0.8: up to 302 files, for one AFAC record PDF per airstrip — the copied 8-file cap failed a KSBA–MMLT pack). Original notes:
// Mexican Airstrips for your EFB and Sim (formerly Airfield KML Builder) — serve a ForeFlight content pack (.zip) the page built, from a real URL (v0.24).
//
// Why: a KML with shapes always imports as a User Map Layer, so its points can't be used in a route.
// A content pack carries the shapes in layers/ and a points-only waypoint KML in navdata/, so one import
// gives the map layer AND a user waypoint at AFAC's reference point that can go in a Maps-tab route.
// ForeFlight imports packs from a hyperlink: https://foreflight.com/content?downloadURL=<this URL>.
// Nothing is stored: the files travel in the URL (deflate-raw + base64url JSON {path: text}), and come
// back zipped. No npm packages (App Conventions §1).
//
// GET /.netlify/functions/pack/<base64url(deflate-raw(JSON)), split into 200-char path segments>/<pack name>.zip
// (older form, still accepted: /.netlify/functions/pack?n=<pack name>&d=<…>)

const zlib = require('zlib');
const crypto = require('crypto');

// ---------- v0.32: short links ----------
// ForeFlight installs a pack from a short address but not from the ~2,000-character one that carried the whole pack
// (Wayne's tests, 14-Nov-2026: the same zip installed from /fftest/TSTG.zip and failed from /fftest/long/…/TSTI.zip).
// So the page POSTs the pack once; it's kept in Netlify Blobs (store "packs") under a 16-hex id from its SHA-256,
// and ForeFlight gets /.netlify/functions/pack/<id>/<NAME>.zip. Blobs over its REST interface, the way
// @netlify/blobs connectLambda() does it (event.blobs = base64 JSON {url, token}; site id in x-nf-site-id) — no npm.
function blobsEnv(event){
  if (!event.blobs) throw new Error('Netlify Blobs not available to this function');
  const { url, token } = JSON.parse(Buffer.from(event.blobs, 'base64').toString('utf8'));
  const site = (event.headers || {})['x-nf-site-id'];
  if (!url || !token || !site) throw new Error('Netlify Blobs context incomplete');
  return { url, token, site };
}
const blobUrl = (env, key) => new URL(`/${env.site}/site:packs/${key}`, env.url).toString();
async function blobPut(env, key, text){
  const r = await fetch(blobUrl(env, key), { method: 'PUT', headers: { authorization: `Bearer ${env.token}` }, body: text });
  if (!r.ok) throw new Error('store failed: HTTP ' + r.status);
}
async function blobGet(env, key){
  const r = await fetch(blobUrl(env, key), { headers: { authorization: `Bearer ${env.token}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('read failed: HTTP ' + r.status);
  return r.text();
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

function zip(files){
  // directory entries first ("XSQA/", "XSQA/layers/" …), as Finder's "Compress" writes them and as ForeFlight's own
  // sample content pack has them (v0.27)
  const dirs = new Set();
  for (const [path] of files){ const parts = path.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/') + '/'); }
  files = [...[...dirs].sort().map(d => [d, null]), ...files];
  const locals = [], centrals = []; let offset = 0;
  const d = new Date(), dosTime = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
        dosDate = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  for (const [path, text] of files){
    const isDir = text === null;
    const name = Buffer.from(path, 'utf8'), raw = Buffer.from(isDir ? '' : text, 'utf8'), comp = isDir ? raw : zlib.deflateRawSync(raw), crc = crc32(raw), method = isDir ? 0 : 8;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(isDir ? 0x10 : 0, 38);   // MS-DOS directory attribute
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp); centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

exports.handler = async (event) => {
  const q = Object.assign({}, (event && event.queryStringParameters) || {});
  // POST body = the base64url payload → { id }
  if (event && event.httpMethod === 'POST'){
    try {
      const d = String(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '')).trim();
      if (!/^[A-Za-z0-9_-]{20,300000}$/.test(d)) throw new Error('bad payload');
      JSON.parse(zlib.inflateRawSync(Buffer.from(d.replace(/-/g, '+').replace(/_/g, '/'), 'base64'), { maxOutputLength: 8_000_000 }).toString('utf8'));
      const id = crypto.createHash('sha256').update(d).digest('hex').slice(0, 16);
      const env = blobsEnv(event);
      await blobPut(env, id, d);
      return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ id }) };
    } catch (e) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: String(e.message || e) }) };
    }
  }
  const short = /\/pack\/([0-9a-f]{16})\/([A-Za-z0-9_-]+)\.zip$/.exec((event && event.path) || '');
  if (short){
    try {
      const d = await blobGet(blobsEnv(event), short[1]);
      if (!d) return { statusCode: 404, headers: { 'Content-Type': 'text/plain' }, body: 'No such pack (links last as long as the server keeps them; build it again in the app).' };
      q.d = d; q.n = short[2];
    } catch (e) {
      return { statusCode: 502, headers: { 'Content-Type': 'text/plain' }, body: 'Could not read the pack: ' + e.message };
    }
  }
  // v0.26: path form /.netlify/functions/pack/<d in 200-char segments>/<NAME>.zip — ForeFlight takes the text after
  // the last "/" as the file name and only imports it as a content pack when that ends in .zip (Wayne, iOS, 14-Nov-2026)
  const m = short ? null : /\/pack\/(.+)\/([A-Za-z0-9_-]+)\.zip$/.exec((event && (event.rawUrl ? new URL(event.rawUrl).pathname : event.path)) || '');
  if (m){ q.d = m[1].replace(/\//g, ''); q.n = m[2]; }
  try {
    if (!q.d || q.d.length > 300000) throw new Error('missing or too large');
    const json = zlib.inflateRawSync(Buffer.from(q.d.replace(/-/g, '+').replace(/_/g, '/'), 'base64'), { maxOutputLength: 8_000_000 }).toString('utf8');
    const obj = JSON.parse(json);
    const name = String(q.n || 'pack').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'pack';
    const files = [];
    for (const [path, text] of Object.entries(obj)){
      // only what a content pack holds: manifest.json, layers/*.kml, navdata/*.kml|*.txt|*.html (v0.64)|*.pdf (v0.66, ASCII-only) — all under <name>/
      // with or without the pack folder on top (ForeFlight's own packs come both ways)
      if (!new RegExp(`^(${name}/)?(manifest\\.json|layers/[^/]+\\.kml|navdata/[^/]+\\.(kml|txt|html|pdf))$`).test(path)) throw new Error('unexpected file ' + path);
      if (typeof text !== 'string') throw new Error('bad file ' + path);
      if (/\.kml$/.test(path) && !/^<\?xml[\s\S]*<kml[\s>]/.test(text)) throw new Error('not a KML document: ' + path);
      files.push([path, text]);
    }
    if (!files.length) throw new Error('no files');
    if (files.length > 302) throw new Error('too many files (' + files.length + '): untick some airstrips');   // v0.8: one AFAC record PDF per airstrip (was 8)
    const body = zip(files);
    return {
      statusCode: 200,
      headers: {
        // v0.30: a plain .zip file from the same site installs in ForeFlight; this function's answer had no
        // Content-Length (sent in chunks) and didn't. Give ForeFlight the length up front.
        'Content-Length': String(body.length),
        'Accept-Ranges': 'none',
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${name}.zip"`,
        // v0.29: never cached — the CDN served an older build of the same pack URL during testing (14-Nov-2026)
        'Cache-Control': 'no-store',
        'Netlify-CDN-Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
      body: body.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Could not rebuild the content pack: ' + e.message };
  }
};
