/* Planning Emergency Airstrips in Mexico — v0.3: ForeFlight content pack for a route's emergency airstrips.
 *
 * Builds, in the browser, a content pack (manifest + map layers + user waypoints) for the airstrips ticked in the
 * list, and hands it to netlify/functions/pack.js (copied from Mexican Airstrips) for a short link ForeFlight opens:
 *   layers/<NAME> Route.kml     route and corridor outline, dashed and thinner than in the app (Wayne)
 *   layers/<NAME> Airstrips.kml runways, traffic patterns, visual approaches (each optional)
 *   navdata/<NAME> Waypoints.kml one user waypoint per airstrip, <code>_EMG (Mexican Airstrips uses <code>_AFAC)
 * Geometry is Mexican Airstrips' (v0.94): runway from OpenStreetMap when it has one near AFAC's point, else a runway
 * drawn from AFAC's point, runway numbers, length and WMM-2025 variation ("estimate"); patterns ½ NM either side;
 * visual approaches modeled on Garmin's calculated visuals with the always-on terrain check (fails closed).
 * Exposes window.FF. NOT FOR NAVIGATION. */
(function(){
  'use strict';
  const R = 6371008.8, NM_M = 1852;
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const ft = m => Math.round(m / 0.3048);
  const pad2 = s => /^\d$/.test(String(s).trim()) ? '0' + String(s).trim() : String(s).trim();
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const today = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`; };
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

  // ---------- geodesy (as in Mexican Airstrips) ----------
  function dist(a, b){ const [la1, lo1, la2, lo2] = [a[0], a[1], b[0], b[1]].map(rad); const h = Math.sin((la2-la1)/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin((lo2-lo1)/2)**2; return 2 * R * Math.asin(Math.sqrt(h)); }
  function brg(a, b){ const [la1, lo1, la2, lo2] = [a[0], a[1], b[0], b[1]].map(rad); const y = Math.sin(lo2-lo1)*Math.cos(la2), x = Math.cos(la1)*Math.sin(la2) - Math.sin(la1)*Math.cos(la2)*Math.cos(lo2-lo1); return (deg(Math.atan2(y, x)) + 360) % 360; }
  function dest(p, b, d){ const la = rad(p[0]), lo = rad(p[1]), br = rad(b), dr = d / R; const la2 = Math.asin(Math.sin(la)*Math.cos(dr) + Math.cos(la)*Math.sin(dr)*Math.cos(br)); const lo2 = lo + Math.atan2(Math.sin(br)*Math.sin(dr)*Math.cos(la), Math.cos(dr) - Math.sin(la)*Math.sin(la2)); return [deg(la2), deg(lo2)]; }
  const enu = o => ({ to: p => [rad(p[1]-o[1]) * R * Math.cos(rad(o[0])), rad(p[0]-o[0]) * R], from: q => [o[0] + deg(q[1]/R), o[1] + deg(q[0]/(R*Math.cos(rad(o[0]))))] });
  function track(a, b, p){ const f = enu(a), B = f.to(b), P = f.to(p), L = Math.hypot(B[0], B[1]) || 1; const ux = B[0]/L, uy = B[1]/L; return { along: P[0]*ux + P[1]*uy, cross: P[0]*uy - P[1]*ux, len: L }; }
  const angDiff = (a, b) => ((a - b) % 360 + 540) % 360 - 180;
  const variation = (lat, lon) => { try { return window.WMM ? window.WMM.declination(lat, lon, new Date()) : null; } catch (e){ return null; } };

  // ---------- surface colors (Mexican Airstrips' SURF) ----------
  const SURF = { asphalt:'#1e1e1e', concrete:'#8f8f8f', dirt:'#6e4321', gravel:'#73695a', grass:'#3d6b2c', water:'#1f5f99', unknown:'#4a4a56' };
  const SURF_WORDS = [['asphalt', /ASFALT|PAVIMENTO|ASPHALT|PAVED|\bASP/], ['concrete', /CONCRET|CEMENTO|CONCRETE/], ['gravel', /GRAVA|GRAVEL|PIEDRA|CALICHE|REVESTIMIENTO/],
    ['dirt', /TERRAC|TERRAERIA|TIERRA|TERRENO|SUELO|ARCILLA|TEPETATE|DIRT|EARTH|GROUND|COMPACTED|SAND|UNPAVED/], ['grass', /PASTO|GRASS/], ['water', /AGUA|ACUATIC|WATER/]];
  function surfCat(s){ const t = norm(s); if (!t) return null; let best = null, at = 1e9; for (const [k, rx] of SURF_WORDS){ const m = rx.exec(t); if (m && m.index < at){ at = m.index; best = k; } } return best; }
  const kmlColor = (hex, a) => (a + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3)).toLowerCase();

  // ---------- OpenStreetMap runway (netlify/functions/osm.js, cached on the device a week) ----------
  const OSM_KEY = 'mxEmergency.osm.';
  async function osmRunways(r){
    const key = OSM_KEY + r.lat.toFixed(5) + ',' + r.lon.toFixed(5);
    try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && Date.now() - c.at < 7 * 864e5) return c.rw; } catch (e){}
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await fetch(`/.netlify/functions/osm?lat=${r.lat.toFixed(5)}&lon=${r.lon.toFixed(5)}`, { signal: ctl.signal });
      const d = await res.json();
      if (!res.ok || !Array.isArray(d.elements)) throw new Error(d.error || 'HTTP ' + res.status);
      const rw = d.elements.filter(e => e.tags && e.tags.aeroway === 'runway' && e.type === 'way' && (e.geometry || []).length >= 2).map(runwayFromWay);
      try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), rw })); } catch (e){}
      return rw;
    } finally { clearTimeout(t); }
  }
  function runwayFromWay(e){
    const t = e.tags || {}, p = e.geometry.filter(Boolean).map(g => [g.lat, g.lon]);
    const closed = p.length > 3 && dist(p[0], p[p.length - 1]) < 1;
    let a = p[0], b = p[p.length - 1], width = parseFloat(t.width) || null;
    if (closed || p.length > 2){
      let best = 0;
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++){ const d = dist(p[i], p[j]); if (d > best){ best = d; a = p[i]; b = p[j]; } }
      if (closed){
        const crosses = p.map(q => track(a, b, q).cross), lo = Math.min(...crosses), hi = Math.max(...crosses), mid = (lo + hi) / 2;
        const f = enu(a), A = f.to(a), B = f.to(b), L = Math.hypot(B[0] - A[0], B[1] - A[1]), nx = (B[1] - A[1]) / L, ny = -(B[0] - A[0]) / L;
        a = f.from([A[0] + nx * mid, A[1] + ny * mid]); b = f.from([B[0] + nx * mid, B[1] + ny * mid]);
        if (!width) width = hi - lo;
      }
    }
    return { a, b, ref: t.ref || '', surface: t.surface || '', width };
  }
  // runway drawn from AFAC's figures (Mexican Airstrips' "starter runway")
  function starterRunway(r){
    if (!r.len) return null;
    const des = (r.rwyArr || []).map(x => parseInt(x, 10)).filter(n => n >= 1 && n <= 36);
    if (!des.length) return null;
    const v = variation(r.lat, r.lon); if (v == null) return null;
    const low = Math.min(...des), tru = (low * 10 + v + 360) % 360, P = [r.lat, r.lon];
    return { a: dest(P, (tru + 180) % 360, r.len / 2), b: dest(P, tru, r.len / 2), ref: '', surface: '', width: null, starter: true };
  }
  // the airstrip's runway: OpenStreetMap's nearest to AFAC's point (within 1.5 km), else the estimate from AFAC's figures
  async function runwayFor(r){
    let rw = null, osmNote = '';
    try {
      const list = (await osmRunways(r)).filter(x => { const t = track(x.a, x.b, [r.lat, r.lon]); return Math.abs(t.cross) < 1500 && t.along > -1500 && t.along < t.len + 1500; });
      list.sort((x, y) => Math.abs(track(x.a, x.b, [r.lat, r.lon]).cross) - Math.abs(track(y.a, y.b, [r.lat, r.lon]).cross));
      rw = list[0] || null;
    } catch (e){ osmNote = 'OpenStreetMap unavailable'; }
    if (!rw) rw = starterRunway(r);
    if (!rw) return null;
    const tb = brg(rw.a, rw.b);
    const des = ((r.rwyArr || []).length === 2 ? r.rwyArr : (rw.ref || '').split('/')).map(s => parseInt(s, 10)).filter(n => n >= 1 && n <= 36);
    if (des.length === 2){ const fit = n => Math.abs(angDiff(n * 10, tb)); const [x, y] = fit(des[0]) <= fit(des[1]) ? des : [des[1], des[0]]; rw.labA = pad2(x); rw.labB = pad2(y); }
    if (!rw.labA){ const v = variation(rw.a[0], rw.a[1]); if (v != null){ const num = h => Math.round((((h - v) % 360) + 360) % 360 / 10) || 36; rw.labA = pad2(num(tb)); rw.labB = pad2(num((tb + 180) % 360)); rw.labEst = true; } }
    rw.width = r.wid || rw.width || 15;
    rw.src = rw.starter ? `estimated from AFAC's point, runway numbers and length (WMM-2025 variation); not checked against imagery${osmNote ? ' (' + osmNote + ')' : ''}` : 'OpenStreetMap runway (© OpenStreetMap contributors, ODbL)';
    return rw;
  }

  // ---------- traffic patterns (Mexican Airstrips v0.60: both sides, ½ NM, downwind arrows, midfield dot, TPA label) ----------
  const PAT_COLOR = '#33d1ff', VIS_COLOR = '#ffb000', PAT_W = 0.5;
  function patterns(rw){
    const h = brg(rw.a, rw.b), w = PAT_W * NM_M, A = rw.labA || 'end A', B = rw.labB || 'end B';
    const mid = (p, q, f = 0.5) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
    const Fa = dest(rw.a, h + 180, w), Fb = dest(rw.b, h, w);
    const out = [-90, 90].map(o => { const Pa = dest(Fa, h + o, w), Pb = dest(Fb, h + o, w);
      return { name: `RWY ${A} ${o < 0 ? 'left' : 'right'} / RWY ${B} ${o < 0 ? 'right' : 'left'} traffic`, lines: [[Pa, Pb], [Pa, Fa], [Pb, Fb]], arrows: [[mid(Pa, Pb, 0.28), h + 180], [mid(Pa, Pb, 0.72), h]], dots: [mid(Pa, Pb)] }; });
    out.push({ name: `RWY ${A} and ${B} final`, lines: [[Fa, rw.a], [Fb, rw.b]], arrows: [], dots: [] });
    return out;
  }
  function dashes(leg, on, off){ const [p, q] = leg, L = dist(p, q), segs = [], at = f => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]; for (let x = 0; x < L; x += on + off) segs.push([at(x / L), at(Math.min(L, x + on) / L)]); return segs; }
  // a dashed polyline: dash pattern carried on across the corners
  function dashPath(pts, on, off){
    const segs = []; let carry = 0, drawing = true, cur = null;
    for (let i = 0; i < pts.length - 1; i++){
      const p = pts[i], q = pts[i + 1], L = dist(p, q); if (!L) continue;
      const at = f => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
      let x = 0;
      while (x < L){
        const left = (drawing ? on : off) - carry, step = Math.min(left, L - x);
        if (drawing){ if (!cur) cur = [at(x / L)]; cur.push(at((x + step) / L)); }
        x += step; carry += step;
        if (carry >= (drawing ? on : off) - 1e-6){ if (drawing && cur){ segs.push(cur); cur = null; } drawing = !drawing; carry = 0; }
      }
    }
    if (cur && cur.length > 1) segs.push(cur);
    return segs;
  }
  const arrow = ([tip, b], len = 120) => [dest(tip, b + 150, len), tip, dest(tip, b - 150, len)];
  const ring = (c, r = 45) => Array.from({ length: 13 }, (_, i) => dest(c, i * 30, r));
  const tpaFt = r => r.elev != null ? Math.round((ft(r.elev) + 1000) / 10) * 10 : null;

  // ---------- visual approaches (Mexican Airstrips v0.67–v0.78), terrain via netlify/functions/terrain.js ----------
  const TER_Z = 12, TAN3 = Math.tan(rad(3)), TAN2 = Math.tan(rad(2)), FT_PER_M = 1 / 0.3048, VIS_LEN = 5, VIS_START_NM = 0.5, VIS_TOL_FT = 50;
  const VIS_CAUTION = 'CAUTION: ADVISORY ONLY. FOR SITUATIONAL AWARENESS ONLY. Not an instrument approach procedure and not for navigation. The 3° path, fixes and altitudes are calculated by this app; no authority publishes or checks them. The terrain check uses a terrain model only: no towers, wires, trees or buildings, and it does not guarantee terrain or obstacle clearance. Use only in VMC with the runway in sight. You are responsible for terrain, obstacle and traffic avoidance.';
  const tiles = new Map(), tileNow = {};
  const tileXY = p => { const n = 2 ** TER_Z, s = Math.log(Math.tan(rad(p[0])) + 1 / Math.cos(rad(p[0]))); return [(p[1] + 180) / 360 * n, (1 - s / Math.PI) / 2 * n]; };
  function getTile(x, y){
    const k = `${TER_Z}/${x}/${y}`;
    if (!tiles.has(k)) tiles.set(k, (async () => {
      const res = await fetch(`/.netlify/functions/terrain?z=${TER_Z}&x=${x}&y=${y}`);
      if (!res.ok) throw new Error('terrain ' + res.status);
      const bmp = await createImageBitmap(await res.blob());
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
      const d = cx.getImageData(0, 0, bmp.width, bmp.height).data, a = new Float32Array(bmp.width * bmp.height);
      for (let i = 0; i < a.length; i++) a[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
      return { w: bmp.width, h: bmp.height, a };
    })().catch(e => { tiles.delete(k); throw e; }));
    return tiles.get(k);
  }
  function elevM(p){
    const [fx, fy] = tileXY(p), tx = Math.floor(fx), ty = Math.floor(fy), t = tileNow[`${tx}/${ty}`];
    const px = (fx - tx) * t.w - .5, py = (fy - ty) * t.h - .5;
    const i = Math.max(0, Math.min(t.w - 2, Math.floor(px))), j = Math.max(0, Math.min(t.h - 2, Math.floor(py)));
    const u = Math.max(0, Math.min(1, px - i)), v = Math.max(0, Math.min(1, py - j)), g = (a, b) => t.a[b * t.w + a];
    return g(i, j) * (1 - u) * (1 - v) + g(i + 1, j) * u * (1 - v) + g(i, j + 1) * (1 - u) * v + g(i + 1, j + 1) * u * v;
  }
  const visHalf = d => Math.min(0.1 * NM_M, 60 + 0.08 * d * NM_M);
  const visSamples = e => { const out = []; for (let k = 1; k <= VIS_LEN * 10; k++){ const d = k / 10, c = dest(e.thr, e.back, d * NM_M), w = visHalf(d); out.push({ d, pts: [c, dest(c, e.back + 90, w), dest(c, e.back - 90, w)] }); } return out; };
  async function visuals(rw){
    const h = brg(rw.a, rw.b);
    const ends = [{ id: rw.labA || 'end A', thr: rw.a, crs: h }, { id: rw.labB || 'end B', thr: rw.b, crs: (h + 180) % 360 }].map(e => ({ ...e, back: (e.crs + 180) % 360 }));
    const need = new Set();
    ends.forEach(e => [[e.thr], ...visSamples(e).map(s => s.pts)].flat().forEach(p => { const [fx, fy] = tileXY(p); need.add(`${Math.floor(fx)}/${Math.floor(fy)}`); }));
    await Promise.all([...need].map(async k => { const [x, y] = k.split('/').map(Number); tileNow[k] = await getTile(x, y); }));
    return ends.map(e => {
      const thrFt = elevM(e.thr) * FT_PER_M, alt = d => thrFt + 50 + d * NM_M * TAN3 * FT_PER_M;
      let pen = null, warn = null;
      for (const s of visSamples(e)){
        const ev = s.pts.map(elevM), k = ev.indexOf(Math.max(...ev)), terr = ev[k] * FT_PER_M;
        if (s.d >= VIS_START_NM - 1e-9 && terr > thrFt + s.d * NM_M * TAN2 * FT_PER_M + VIS_TOL_FT){
          if (s.d < 3){ if (!warn || alt(s.d) - terr < warn.c) warn = { d: s.d, c: alt(s.d) - terr, p: s.pts[k] }; }
          else { pen = s.d; break; }
        }
      }
      const state = warn && warn.c <= 0 ? 'none' : pen == null ? 'ok' : 'cut';
      const len = state === 'ok' ? VIS_LEN : state === 'none' ? 0 : Math.round((pen - 0.1) * 10) / 10;
      const fx = d => ({ d, p: dest(e.thr, e.back, d * NM_M), alt: Math.round(alt(d) / 10) * 10, above: Math.round((alt(d) - thrFt) / 10) * 10 });
      const marks = len ? [...new Set([2, 5].filter(d => d <= len + 1e-9).concat([len]))].sort((x, y) => x - y).map(fx) : [];
      return { ...e, len, warn, state, thrFt: Math.round(thrFt), marks, out: dest(e.thr, e.back, len * NM_M) };
    });
  }

  // ---------- KML ----------
  const C5 = pts => pts.map(p => `${p[1].toFixed(5)},${p[0].toFixed(5)},0`).join(' ');
  const LS = pts => `<LineString><tessellate>1</tessellate><coordinates>${C5(pts)}</coordinates></LineString>`;
  const head = name => `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n<name>${esc(name)}</name>\n`;
  const style = (id, hex, a, w, fill, fa) => `<Style id="${id}"><LineStyle><color>${kmlColor(hex, a)}</color><width>${w}</width></LineStyle>${fill ? `<PolyStyle><color>${kmlColor(fill, fa)}</color></PolyStyle>` : '<PolyStyle><fill>0</fill></PolyStyle>'}</Style>`;
  const lbl = `<Style id="lbl"><IconStyle><scale>0.6</scale></IconStyle><LabelStyle><scale>1.0</scale></LabelStyle></Style>`;
  // v0.3 (Wayne): route and corridor dashed and thinner than in the app, so they don't clutter ForeFlight's map
  function routeKml(name, W, corridorRings, corNM){
    let k = head(name) + style('route', '#f5a623', 'ff', 1.5, null) + style('corr', '#f5a623', 'b3', 1, null);
    const route = W.map(w => [w.lat, w.lon]);
    k += `<Placemark><name>Route ${esc(W.map(w => w.code).join(' '))}</name><description><![CDATA[Route from Planning Emergency Airstrips in Mexico. NOT FOR NAVIGATION.]]></description><styleUrl>#route</styleUrl><MultiGeometry>${dashPath(route, 2.5 * NM_M, 1.5 * NM_M).map(LS).join('')}</MultiGeometry></Placemark>\n`;
    if (corridorRings && corridorRings.length) k += `<Placemark><name>Corridor ${corNM} NM</name><description><![CDATA[${corNM} NM either side of the route. NOT FOR NAVIGATION.]]></description><styleUrl>#corr</styleUrl><MultiGeometry>${corridorRings.map(r => dashPath(r, 1.5 * NM_M, 1.5 * NM_M).map(LS).join('')).join('')}</MultiGeometry></Placemark>\n`;
    return k + '</Document></kml>\n';
  }
  function airstripsKml(name, items, opt){
    let k = head(name) + lbl + style('cl', '#ffffff', 'ff', 1, null) + style('pat', PAT_COLOR, 'ff', 2, null) + style('vis', VIS_COLOR, 'ff', 3, null)
      + `<Style id="tpa"><IconStyle><scale>0</scale></IconStyle><LabelStyle><color>ffffffff</color><scale>0.9</scale></LabelStyle></Style>`
      + `<Style id="visfix"><IconStyle><color>${kmlColor(VIS_COLOR, 'ff')}</color><scale>0.5</scale></IconStyle><LabelStyle><color>${kmlColor(VIS_COLOR, 'ff')}</color><scale>0.85</scale></LabelStyle></Style>`
      + `<Style id="viswarn"><IconStyle><color>${kmlColor('#e0705f', 'ff')}</color><scale>0.6</scale></IconStyle><LabelStyle><color>${kmlColor('#e0705f', 'ff')}</color><scale>0.85</scale></LabelStyle></Style>\n`;
    Object.entries(SURF).forEach(([s, hex]) => { k += style('rw_' + s, '#ffffff', 'ff', 1.5, hex, 'ff'); });
    const withRw = items.filter(x => x.rw);
    if (opt.runways){
      k += '<Folder><name>Runways</name>';
      withRw.forEach(({ r, rw, wp }) => {
        const b = brg(rw.a, rw.b), w = rw.width / 2, poly = [dest(rw.a, b - 90, w), dest(rw.b, b - 90, w), dest(rw.b, b + 90, w), dest(rw.a, b + 90, w)]; poly.push(poly[0]);
        const nm = `${wp} RWY ${rw.labA || ''}/${rw.labB || ''}${rw.labEst ? ' (est.)' : ''}`;
        k += `<Placemark><name>${esc(nm)}</name><description><![CDATA[${esc(r.name)}: ${esc(rw.src)}. NOT FOR NAVIGATION.]]></description><styleUrl>#rw_${surfCat(r.surf) || 'unknown'}</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${C5(poly)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
        k += `<Placemark><name>${esc(nm)} centerline</name><styleUrl>#cl</styleUrl>${LS([rw.a, rw.b])}</Placemark>`;
        if (rw.labA) k += `<Placemark><name>${esc(rw.labA)}</name><styleUrl>#lbl</styleUrl><Point><coordinates>${C5([dest(rw.a, b + 180, 40)])}</coordinates></Point></Placemark>`;
        if (rw.labB) k += `<Placemark><name>${esc(rw.labB)}</name><styleUrl>#lbl</styleUrl><Point><coordinates>${C5([dest(rw.b, b, 40)])}</coordinates></Point></Placemark>`;
      });
      k += '</Folder>\n';
    }
    if (opt.patterns){
      k += '<Folder><name>Traffic patterns</name>';
      withRw.forEach(({ r, rw, wp }) => {
        const tpa = tpaFt(r);
        patterns(rw).forEach(P => {
          const geom = [...P.lines.flatMap(l => dashes(l, 150, 100)), ...P.arrows.map(a => arrow(a)), ...P.dots.map(d => ring(d))].map(LS).join('');
          k += `<Placemark><name>${esc(wp + ' ' + P.name)}</name><description><![CDATA[${esc(P.name)}, pattern width ${PAT_W} NM; dot abeam midfield. ${tpa != null ? `TPA assumed 1,000 ft AGL ≈ ${tpa.toLocaleString('en-US')} ft MSL` : 'AFAC gives no elevation'}. AFAC publishes no pattern direction. NOT FOR NAVIGATION.]]></description><styleUrl>#pat</styleUrl><MultiGeometry>${geom}</MultiGeometry></Placemark>`;
          if (tpa != null) P.dots.forEach(d => { k += `<Placemark><name>TPA ${tpa.toLocaleString('en-US')}'</name><styleUrl>#tpa</styleUrl><Point><coordinates>${C5([d])}</coordinates></Point></Placemark>`; });
        });
      });
      k += '</Folder>\n';
    }
    if (opt.visuals){
      k += `<Folder><name>Visual approaches (advisory)</name><description><![CDATA[${esc(VIS_CAUTION)}]]></description>`;
      withRw.filter(x => x.vis).forEach(({ rw, wp, vis }) => vis.filter(e => e.len).forEach(e => {
        const ah = dest(e.out, e.crs, 0.2 * NM_M), nm = `${wp} RWY ${e.id}${rw.labEst ? ' (est.)' : ''} visual (advisory)`;
        const geom = [...dashes([e.thr, e.out], 400, 220), [dest(ah, e.crs + 150, 160), ah, dest(ah, e.crs - 150, 160)]].map(LS).join('');
        const wtx = e.warn ? ` TERRAIN WITHIN ${Math.round(e.warn.c / 10) * 10} FT BELOW THE PATH ${e.warn.d} NM OUT.` : '';
        k += `<Placemark><name>${esc(nm)}</name><description><![CDATA[<b>${esc(nm)}</b><br>Final ${Math.round(e.crs) || 360}° true, 3.00°, TCH 50 ft, ${e.len} NM${e.state === 'cut' ? ' (shortened: terrain beyond)' : ''}.${wtx} Threshold elevation ${e.thrFt.toLocaleString('en-US')} ft (terrain model).<br><br><b>${esc(VIS_CAUTION)}</b>]]></description><styleUrl>#vis</styleUrl><MultiGeometry>${geom}</MultiGeometry></Placemark>`;
        if (e.warn) k += `<Placemark><name>${esc(`${e.id} terrain ${e.warn.d}NM`)}</name><description><![CDATA[Terrain within ${Math.round(e.warn.c / 10) * 10} ft below the ${esc(nm)} path, ${e.warn.d} NM from the threshold (terrain model; no obstacles).<br><br><b>${esc(VIS_CAUTION)}</b>]]></description><styleUrl>#viswarn</styleUrl><Point><coordinates>${C5([e.warn.p])}</coordinates></Point></Placemark>`;
        e.marks.forEach(f => { k += `<Placemark><name>${esc(`${e.id} ${Number.isInteger(f.d) ? f.d : f.d.toFixed(1)}NM ${f.alt.toLocaleString('en-US')}'`)}</name><description><![CDATA[${esc(nm)}: ${f.d} NM from the threshold, ${f.alt.toLocaleString('en-US')} ft MSL (${f.above.toLocaleString('en-US')} ft above the threshold).<br><br><b>${esc(VIS_CAUTION)}</b>]]></description><styleUrl>#visfix</styleUrl><Point><coordinates>${C5([f.p])}</coordinates></Point></Placemark>`; });
      }));
      k += '</Folder>\n';
    }
    return k + '</Document></kml>\n';
  }
  function waypointsKml(name, items, edition){
    let k = head(name) + `<Style id="wp"><IconStyle><color>ff23a6f5</color><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/airports.png</href></Icon></IconStyle><LabelStyle><scale>1.0</scale></LabelStyle></Style>\n`;
    items.forEach(({ r, rw, wp }) => {
      const p = rw ? [(rw.a[0] + rw.b[0]) / 2, (rw.a[1] + rw.b[1]) / 2] : [r.lat, r.lon];
      const d = [`${r.des ? r.des + ' ' : ''}${r.name}, ${[r.muni, r.state].filter(Boolean).join(', ')}`,
        r.elev != null ? `Elev ${ft(r.elev).toLocaleString('en-US')} ft (AFAC)` : 'Elev not in AFAC list',
        (r.rwyArr || []).some(x => /^\d/.test(x)) ? `RWY ${r.rwyArr.map(pad2).join('/')}` : '', r.len ? `${ft(r.len).toLocaleString('en-US')} ft ${r.surf || ''}` : '',
        `AFAC permit: ${r.status || 'not listed'}${r.terc ? '; open to third parties' : '; private use'}`,
        `Waypoint at ${rw ? (rw.starter ? 'the midpoint of the runway estimated from AFAC figures' : 'the midpoint of the OpenStreetMap runway') : "AFAC's reference point"}.`,
        `Source: AFAC list (${edition} edition). Planning Emergency Airstrips in Mexico. NOT FOR NAVIGATION.`].filter(Boolean).join('. ');
      k += `<Placemark><name>${esc(wp)}</name><styleUrl>#wp</styleUrl><description>${esc(d)}</description><Point><coordinates>${p[1].toFixed(6)},${p[0].toFixed(6)},${r.elev != null ? r.elev : 0}</coordinates></Point></Placemark>\n`;
    });
    return k + '</Document></kml>\n';
  }
  // <designator>_EMG (Mexican Airstrips uses _AFAC, so both packs can be installed together); no designator: letters of the name
  function wpName(r, used){
    let w = r.des ? norm(r.des).replace(/[^A-Z0-9]/g, '') : norm(r.name).replace(/[^A-Z0-9]+/g, '').slice(0, 8);
    if (!/[A-Z]/.test(w)) w = 'X' + w;
    w += '_EMG'; let n = w, i = 2; while (used.has(n)) n = w.replace('_EMG', i++ + '_EMG'); used.add(n); return n;
  }
  const stamp = () => { const d = new Date(Date.now() - 60000), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`; };
  async function b64deflate(text){
    const cs = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(cs).arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // build({ W, corridorRings, corridor, airstrips:[records], opt:{route, waypoints, runways, patterns, visuals}, edition, progress(text) })
  // → { url, name, abbr, notes:[…], counts }
  async function build(a){
    const opt = a.opt, codes = a.W.map(w => w.code.replace(/[^A-Z0-9]/gi, '').toUpperCase());
    const abbr = ('EMG_' + codes[0] + '_' + codes[codes.length - 1]).slice(0, 30);
    const title = `${codes.join('-')} emergency airstrips`.slice(0, 60);
    const used = new Set(), items = a.airstrips.map(r => ({ r, wp: wpName(r, used) }));
    const notes = []; let est = 0, noRw = 0, visFail = 0;
    if (opt.runways || opt.patterns || opt.visuals || opt.waypoints){
      for (let i = 0; i < items.length; i++){
        a.progress(`Runways: ${i + 1} of ${items.length} (${items[i].wp})…`);
        items[i].rw = await runwayFor(items[i].r);
        if (!items[i].rw) noRw++; else if (items[i].rw.starter) est++;
      }
    }
    if (opt.visuals){
      for (let i = 0; i < items.length; i++){
        if (!items[i].rw) continue;
        a.progress(`Terrain check for the visual approaches: ${i + 1} of ${items.length}…`);
        try { items[i].vis = await visuals(items[i].rw); } catch (e){ visFail++; }
      }
    }
    if (est) notes.push(`${est} runway${est > 1 ? 's' : ''} estimated from AFAC's figures (no OpenStreetMap runway): may sit off the real airstrip.`);
    if (noRw) notes.push(`${noRw} airstrip${noRw > 1 ? 's have' : ' has'} no runway numbers or length in AFAC's list, so only the waypoint is sent.`);
    if (visFail) notes.push(`Terrain data didn't load for ${visFail} airstrip${visFail > 1 ? 's' : ''}, so no visual approaches for ${visFail > 1 ? 'them' : 'it'} (the terrain check can't be skipped).`);
    const files = { [`${abbr}/manifest.json`]: JSON.stringify({ name: title, abbreviation: abbr, version: 1, effectiveDate: stamp(), organizationName: 'GeezerGeek Pilot Planning Emergency Airstrips in Mexico' }, null, 1) };
    if (opt.route) files[`${abbr}/layers/${abbr} Route.kml`] = routeKml(`${abbr} Route`, a.W, a.corridorRings, a.corridor);
    if ((opt.runways || opt.patterns || opt.visuals) && items.some(x => x.rw)) files[`${abbr}/layers/${abbr} Airstrips.kml`] = airstripsKml(`${abbr} Airstrips`, items, opt);
    if (opt.waypoints && items.length) files[`${abbr}/navdata/${abbr} Waypoints.kml`] = waypointsKml(`${abbr} Waypoints`, items, a.edition);
    if (Object.keys(files).length < 2) throw new Error('Nothing to send: tick at least one item.');
    a.progress('Building the pack…');
    const d = await b64deflate(JSON.stringify(files));
    if (d.length > 300000) throw new Error('The pack is too big. Narrow the corridor, untick some airstrips or leave out the patterns or visual approaches.');
    const res = await fetch('/.netlify/functions/pack', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: d });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.id) throw new Error(j.error || 'The pack server didn\'t answer (HTTP ' + res.status + ').');
    return { url: `${location.origin}/.netlify/functions/pack/${j.id}/${abbr}.zip`, abbr, title, notes, wps: items.map(x => x.wp), built: today() };
  }

  window.FF = { build, VIS_CAUTION };
})();
