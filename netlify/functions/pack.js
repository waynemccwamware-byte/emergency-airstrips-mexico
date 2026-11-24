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
// v0.98 / v0.10 (24-Nov-2026; blue added v1.00 / v0.13 for the pattern midfield dot): small dot icons for the pack's map-layer points (Wayne: keep the airstrip pin, the rest small dots).
// 64 px PNGs, colored fill with a dark ring (tools/dots/mk.py). A layers/*.kml whose styles point at files/ggp-dot-*.png goes into
// the pack as a .kmz (doc.kml + files/) — ForeFlight takes custom icons only from a KMZ (support article 115006023427).
const DOT_PNG = {
  'ggp-dot-white.png': 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAALBUlEQVR42u1bXWwU1xX+zp3d9cyw659dG4iapDzYSCuVlQmBJGolUIqdSk3T2FRVYvJUS5FMgsgDScRT1SeaKFIDJfiJvFR1EyWYNE0rSN0KpBZaE1pjR6wEVv5QBIbdteOfmfHu3nv7kLnD9bA2kGJYt77SypK93r3fd757zrnnnCEs/iIAzP8pAQj/53/73tu2ucVYzH/x+QAkk8lazrkBAIZh8EKhMLnAHg2fDFHtBBia5QAATU1Nq6WUDwDYACAD4D4A9VLKFBFFAEBKWSaiPIAJABcBDAM4Q0T/unr16uUQseQTW1UEGLpcm5qamqWUjwP4MYD1RFQX/gcp5wqD6PqtSCm/AvBvAL8nog+uXr06Gjoq/G4TMMciK1eubBNCPAfgMcaYKaVUQHX5kvaag1d7BceIiEBEEEJ4AI4xxt64cuXKn+dT3J0kwFDAk8nkVsbYz4noe5p1yyGntqDFw4rQSFHKiqj/kVL+TQjxi0KhMBDey50gIJBffX39tw3D2MsYe9rfmNrsHNCMMWiWhBACnPMANBHBMAwwxsAYg1KOEKISGUREDACEEL/jnO+ZmJj4PHwMF4sA9X6ZSqW2E9HrRNSoATd0CxuGAc45PM+D53kQQqCmpgaWZSGRSCASiQAAyuUypqam4LouZmdnwRiDaZowTTP4jJBCuCJCSpmTUr6Qz+d/q+9vMQhgPsORxsbG14noOU3qEd3ajDG4rouZmRnYto3m5mZs3LgRra2tSKfTWL16NZLJJKLRKACgVCqhUCjg8uXLyGazGBoawunTpzE6OgrHcbBixQpYlhWoR1tldTSklG/kcrkX/N+xm/ULdCvgk8lkLWOsnzH2fSEE16WuLO44DhzHQXNzMzo6OtDR0YFMJoOamppbktrs7CyGh4dx5MgRHDlyBKOjo7BtG7ZthxUhAQjGmCGE+IsQotPPKW6KBLpZ8I2NjfcAOEpEGSllCUA08Ia+TMfHx5FOp9HT04Ouri7U19df06y/aeULKjlB9VJkqjUxMYG+vj709vYim82ioaEh+E5tlYgoKqUcBvCDXC536WZIoJsAL1OpVJyI/k5E66SUcyQfiUQwNTUF0zSxa9cu7Nq1C7W1tcHZ1h3grSzdESpfMTk5iX379mHfvn3wPA+JRALlcnnOkSCiiJRyREr53Xw+P+1jFN+EgCCENTY2HiOiRyuBz+fzaG1tRW9vLzZs2BBYWwG/HUsRoVRx5swZ9PT0YGhoCKlUaj4S/prL5R670Z3CWOB7IwB4Y2PjrxljPw3LPhKJ4MqVK9i+fTvefvttrFmzBuVyGUR0W8Er/6LCI+cc9957L5566ilcvHgRp06dQiKR0J0jA1BijDVbltXoOM4HPhZxKwQYPvinieiXlcDncjm8+OKLOHDgAGpqasA5RyQSua3A5yOCcw7TNNHR0QHP8zAwMIB4PK6TYEgpS0T0sG3b5x3HGdayxhsSwADIZDL5LSL6E4CY7u0jkQjGxsbw0ksvYe/eveCcBxu7U0upQQiBtrY2uK6LY8eOoba2VidBXanbTNP8jeu6KjLImyFA2LZ9iDH2gJ90GPqZf+aZZ3DgwAGUy2UYhrGoVl9IDUQEzjna29vx6aefYnBwUFcCAeBEZAO4z3XddyoRQPNIfzMRHZdSBuANw8D09DTS6TROnDgB0zQDa9zNpSzueR42b96MbDaLeDyuh0hORIaUcksulzsRvjewCpcPAHgl/EWcc8RiMRw6dAi2bUNKedfB68fBtm0cOnQIsVgsnB8ghEmG5T7nTp9KpR4loof8/D6QfqFQwO7du5HJZALpV8syDAPlchmZTAa7d+9GoVAIcgffIQoieiiVSj3qRwOj0hEwAPBUKvUHxtgPfflHGGPwPA/3338/Tp06Bdu2v1Fis9hLJU6O4+CRRx7BF198AdM01REpE5EhhPhjPp//kX4MmKYEXldXt4aI2v0821ASm5mZwc6dOwMHU23glVMUQiAej2Pnzp2YmZnRj6jhp9jtdXV1a3zwLEwAotHok0QU066bcF0XLS0t6OrqgpSyqqRf6ShIKdHV1YWWlha4rquMpSJCLBqNPqljVgQIX0Yd+tFQnn/btm2BZ61G6+sq4JwjHo9j27ZtmJ6e1g1GIYxCr+mJeDzeBGCDL3+mPL9t2+js7AxuadW+/NoAOjs7g6uzsriPbYOPVQAgVb+HaZoPMsZWBH/wnd/atWuxbt26666o1XwMiAjr1q3D2rVr4Xme8gXk1w1WmKb5YBBFtWOwcY40/KrOpk2bEI1G54utVbk454hGo9i0aRNc19WdoQhhZUHBgIi+Uym0tLa2LlS1rcql9tra2lpx3xpWwTQHuEZ3FqqAmU6n521cVLMfAIB0Oo2amprwBUnHKoLLgZSyPkyAZVlYtWrVkiVg1apVQTE1RIDCKplqVBJRgy8XUuEkkUigoaFhyRLQ0NCARCKhh2/yo1lDMpms1cOdoRc81DmKRqOIxWJYqisWiyEajVbyA1HVmWb4P19M9ecBlMIyKpVKKBaLSxZcsVhEqVSqdHxLPuavCSgUCpNSynH/jVLl/FNTUxgfH1+yYXB8fBxTU1PBHQGA9DPFcTWQoXd2JvSCgUqExsbGliwBY2Nj4URIhrBeS4WJ6LMwAbOzs8hms0uWgGw2GzRbQwR8dl0qLKX8uFI4GRoaWrJhcGhoaL7Jk4+vS4UBnNYdo0qEBgcHUSqVlsRFSL8QlUolDA4OhhMhFsJ6LRX2PO8jIcSMKh0LIWCaJs6fP4+RkZGgK7MULkJSSoyMjOD8+fN6WUwCYEKIGc/zPgqnwmx6evoqvp7MCm5Nqt3d398f3LOXwvknIvT398NxHF25wsd2xsfKglRYc4RHdGehqiuHDx8OqivVTIIK39PT0zh8+HC4PyBDGK8viZVKpfeklEXVR5NSwrIsXLhwAX19fUHJqZrlT0To6+vDhQsXYFlWEP/9wmixVCq9p2NeLotX+KxfabMBEELAtm2cO3cO+/fvD7qz1Wh9xhj279+Pc+fOwbbtsPcnH9uCAxJqHOYffneI610UzjmOHz+OTCYDznnVhEa1l+HhYWzZsiW8L9Ub/Gcul3s4PDbD5iHk5UqxtVgsoru7G47jBI2Iu71Uo8ZxHHR3d6NYLM5nmJcrGT1MAAdg5HK5E0KId4jI8MfOggLJ2bNnsWPHDjDGIIS4q1FBzQgwxrBjxw6cPXs2KIDg2riMIYR4p1JneL75AAIAy7JOElE3ANP3oqRaTydPnoTneWhvbw8scKedoj5AtWfPHhw8eBBNTU36vJDwsUxKKZ9wXXe6UnfYmGc+13Bd9yvbtj8nop/4KjCU5GprazEwMADXddHW1haExzvVLlffxRjDnj178Nprr2HlypUVh6UA/Cyfz5/URmlvakZIAog4jjNs2/ZKxtjD/pxQQEI8HseHH36ITz75BFu3boVpmsGQ1GKpQaXjajTv2WefRW9vb9jy8IekolLKg7lc7hU18LU8JneLY3JBO8myrH4AjxPRPdosbqCEL7/8Em+99RZmZ2exfv16WJYFIpqzsW86KKlCHGMMk5OTePXVV/H888/j0qVLqK+vX2hQst113dkbDU/fiAAJgLmuO2vb9nsA2nwS5hwH0zQhpcTRo0fx/vvvAwBaWlrmZI2c8wWjhrKyeo9SEGMMExMTePPNN9HT04N3330XlmXBNM0FR2Xz+Xz+dozKLg9LL4/LLz8wsfzIzPJDU8uPzS0/OLn86Ozyw9P/q4/P/wfyZlYOF2VFggAAAABJRU5ErkJggg==',
  'ggp-dot-amber.png': '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',
  'ggp-dot-red.png': 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAALn0lEQVR42u2bW2wc53XHf+f7ZmYvpLjkLqmadmRdso4rKHIaKYWV1k4D11aMNLDVCwokAfxQO33JS/yUFAVS9KGoExRoiiLtQ+MXF24fgqZqkRSK0wYubKstnCiVFUNtQ4iyBakqubwsL3uZy3f6sDPL4YqUaceSSYQfMFiQO+R8/3P+5/Kdc0a49UsAk34q4NLPn/bed21zt2KZ9Eo2A1CtVkeSJLEA1tpkfn5+6SZ7tKkw3HYXgM1pDoCJiYk7VPUYcBy4D9gHjKpqTUQ8AFWNRWQOWASuAK8BPxSRc7Ozs9cHBCupYLeVAGyerhMTE3VV/RTwOPBhEakM/oHqemKI3LgVVW0CPwL+QUS+PTs7OzVgKsl7LYB1Gtm7d+8jzrnPA58wxhRVNQOap6/krnV4c1ffjEQEEcE51wG+a4z5+szMzPc2Y9ztFIDNgFer1YeNMX8gIg/ktBsPOLWbPngTT5d3hF7GElV92Tn3h/Pz8/88uJfbIYA+/UZHR/dba//YGPPpdGPZZteBFhFMHpEqiSqZFYiAFcGI9P/I3WgmmTBERAyAc+5vkyT5vcXFxTcGzfBWCSC7X2u12mdF5GsiMp4DbtdJyQjOKd3E0UkSVCGwhqJnGfI9vFSjsSqrUUwnTggThwgUraVgTf9/DKBKMkGoakNVvzA3N/d8fn+3QgAmlbA3Pj7+NRH5fI7q3pq2wSB0k4TVKKHkWw6MDPMLE2McrlWoj+5hvFSkUvDxTY8XkXM0uxGNdoepxWUuzjX5z9kFLi+t0I4ShnxLwVoca6xJV5yZhqp+vdFofCH9ndmqX5C3A75arY4YY75ljPlV51wySHXPCO04oR0nHBgZ4tEDd/GJg3dy71iFsWKACCROSZwSq5LpVRA8EazpXaqw0An574Um352+xpnLV7m8tErJs5Q8S+xuNA1jjHXO/Ytz7jfSnGJLQpCtgh8fH58EzojIfaoaAX7/BhGcKs1uSH10hCeOHOJU/W7uGCoSpvTPNi2bhL3M3jUnzKK1BNZwfbXD6ak3ee71S0wtLlEpBP1n5lYkIr6qvgY82mg0/ncrQpAtgNdarTYsIq+IyFFVXUd5zwgrYUxgDU8dvYcnj9bZWy6xEkZ0E4eRHti362w0FYpTKFjDcOAz02rz7IUpvnHhJ4SJYzjwBtkQi4inqhdU9Zfn5uZWUozuZqHsrby9GRoa+o6InNgI/EIn5N7qCH/58Ak+8/MHSRRWwhhSz/5OwPeThTQyOGA1iil6lkf2T3L/5DjnZua5stxiyPfIycCkQpgE7m+1Ws9vJZZvtjwgGR8f/3NjzG8P0t6KMNfp8nh9H3918pc4UBlmodMFkR7wd/s0lQpiJYo4UNnDqfrdvLm8yrmZeYZ8L+/2DRAZY+qlUmm81Wp9O8Xi3o4AbAr+0yLyzEbgF7ohn7vvA3z1Y8dBoB0neMbcstNVXhCdJCGwhsfev4+VKObstVnK3johWFWNROREuVz+n1ar9Voua3xLARhAq9XqXSLyT0CQ9/ae6Wn+c/d9gD964MOsRDGJU6zcSugDGxTpRRNVPnnofSx2Q16+OsNwsM4csiP1I8Vi8a/b7XYWGXQrAnDlcvlZY8yxNOmweZt/vL6Pr37sOCtRjKpibiP4fHap2kuyHt4/yaXmMudnF/I+QYBERMrAvna7/c2NBCCbUP9XRORFVe2DNyK0opj62B7+7rGPE1hDlLj3BHx+OVV8awgTx2/+44tMLSxT9r18iExExKrqxxuNxr8OnhvMJmeSr2z0oMAannnwGHsCn3AbgM8UEyaOPYHPMw8eI7BmMD9gAJMO0n3dmb5Wqz0kIven+X2vYmOEZjfkqaP38NHJCZa64W21+bcMZSIsdUM+OjnBU0fvodkNsUbyDtGJyP21Wu2hNBrYzRgA8HT+jC1AJ06oj47w5NE6zTDCGsN2W9YYmmHEk0fr1EdH6MRJ3r6zw9rTGzm87DOpVCoHRORkmpbmbD/hiSOH2Fsu9U5rbL8lQJg49pZLPHHkEK0oyZuoVVVE5GSlUjmQ+gAzKAB83z8lIkH/uAl0E8fByhCn6vtYDqM8tbYhC4TlMOJUfR8HK0N015SVRYTA9/1TecwmRxFU9dfz0cGIsBpFPHrwLu4YKhNtU+3nWRAljjuGyjx68C5WoyjPAhnA6PI1PTc8PDwBHE/pb7I7Sp7Hyf139gsV232J9Ezh5P47KXlePv81KbbjKVYHSFa/p1gsfsQYM9T/QoRunHCwMszhWoVOHG+LsLeVsNiJYw7XKhysDNON+75A0rrBULFY/Eh2u8mZwS/mqSFAJ0n40N4xxgoBsSo7ZcWqjBUCPrR3jE5yQzTIYzX9goGIfHCj2v3hamXDmv32NwXhcLVyQ/9hAKszOQd4YJ2zAAJrqY+OELvt7fw2coaxc9RHRwiszad+MoDV9Q8Hqjqav8mpUvQs46VgsOqyM8zAKeOlgKJn86mxDGBVkzUqRWQspYsIveLlsO9RKQS4XhKxo+jvVKkUAoZ9j8RpPx9IE6KxarU60g93aZfWHzwVeSL4xqDsPAYoim8MnshGu/ezzrThZ3yZrD8PRDc4ElUi5xB2YBRAiJwjVt1o91GKuSeA+fn5JVVdSO1cNc2rV6KYZjfEpNWXHUP/tErV7IasRHGv2ZJ+lVaSFrKBjH6tT0QW8wWDXkaV0GiHeGbnMcAzQqMd0onXnQp1AOtaKiwil9fdBIRJwtTiEp4xO8oNKuAZw9TiEuH6TFAHsK6lwqr6443CycX55o6if94MLs43N5s8+fENqTDwat4xKr0W9fmZBRa6Yb+VvSPon/Ytzs8sUFyfCZoBrGupcKfT+YFzbjUrHTtVCp5lurnCxbkmRc/brNi4rVYvg/W4ONdkurlCYS0TVMA451Y7nc4PBlNhs7KyMktvMmtdsaAdx7zwxjUCa9gJlpANYbzwxjXacZxPdFyK7YcpVtNPhXOO8O/zzsKpMuT7nJm+yvXVFr7d3s5QAd8arq+2ODN9lSHfz7NWBzDeWBKLoui0qoZZH03ptaanm6ucnrrCnsAn2cYHo8QpewKf01NXmG6uUlhTmKaF0TCKotODJbHsB9tsNi+r6gspVZKMBWXf8tzrl5hptXumsE21H1jDTKvNc69fouzbwe4QqvpCs9m8nBuo2vAs8Ke52YBeNPAsU4tLPHthikrgkzi3DbXvqAQ+z16YYmpxiaJ3g/eXFNtNJ0SycZh/T7tDSb6L4lT5m197kGM/V+uVyLdJaEy0R/1z/zfHZ77z0mDtMusN/kej0TgxODZjNhHIFzfrwX3ppXMsh9HNenC3PewF1rAcRnzppXM361l+cSOl2w1MybZarelSqXTEGPPBbOwsM4Uryy3eXF7lsffvS4cd37tiSXboKVrL0y++yitXZ6kUfJI1xcQi4jnnvjk3N/cnG02U2s0Gp0ql0lkReRIopoIRpzDke5ybmWclivnkoffRTdx7UjFyKfhKIeDLZ8/z/MVpaqVCvnznUixLqvpYu91e2ag7bDdxqLbdbjfL5fIbIvJbKQts78E9IZy9NstiN+Th/ZMgvRrc7eobJCnti9by5bPn+caFn1AtFvKa72sf+J25ubmzec+/lRkhBbxWq/VauVzea4w5kc4J2ezLsufx8tUZLjWXeejuSfYEPu04fsdTYVsNdYlzjBQC2nHC0y++yvMXpzcCHxljfFX9i0aj8ZVs4Iu3OSWW+YMzpVLpARGp58ZQUWA48Dg/u8D3r1znSG2Ue8cqhM4ROX1XBaFpkuMbQ7VY4NXrDX73e//GK1dnqZU21Lyvqt9vNBqf/WnmBPvtpFKp9C3gU+n8XV8ImTn0JjmvsBrFHJ0YZaJcJE4FkTXs3umgZKIQGMNoMaDZDfmzc//F77/8I2ZbXSoF/2aDkifb7Xb3rYand0dld4eld8fld1+Y2H1lht2Xpth9bY7dFyd3X51l9+VpfvZen/9/JcUL+cnlKicAAAAASUVORK5CYII=',
  'ggp-dot-orange.png': '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',
  'ggp-dot-blue.png': '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',
};

// KMZ: doc.kml first, then the dot PNGs it names, no directory entries (Google Earth's own layout)
function kmz(text){
  const names = [...new Set((text.match(/files\/ggp-dot-[a-z]+\.png/g) || []))].filter(n => DOT_PNG[n.slice(6)]);
  return zip([['doc.kml', text], ...names.map(n => [n, Buffer.from(DOT_PNG[n.slice(6)], 'base64')])], false);
}

function zip(files, withDirs = true){
  // directory entries first ("XSQA/", "XSQA/layers/" …), as Finder's "Compress" writes them and as ForeFlight's own
  // sample content pack has them (v0.27)
  const dirs = new Set();
  if (withDirs) for (const [path] of files){ const parts = path.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/') + '/'); }
  files = [...[...dirs].sort().map(d => [d, null]), ...files];
  const locals = [], centrals = []; let offset = 0;
  const d = new Date(), dosTime = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
        dosDate = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  for (const [path, text] of files){
    const isDir = text === null;
    const name = Buffer.from(path, 'utf8'), raw = isDir ? Buffer.alloc(0) : Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8'), comp = isDir ? raw : zlib.deflateRawSync(raw), crc = crc32(raw), method = isDir ? 0 : 8;
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
      // a map layer that uses the dot icons goes in as a .kmz (see DOT_PNG)
      if (/^(.+\/)?layers\/[^/]+\.kml$/.test(path) && /files\/ggp-dot-/.test(text)) files.push([path.replace(/\.kml$/, '.kmz'), kmz(text)]);
      else files.push([path, text]);
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
