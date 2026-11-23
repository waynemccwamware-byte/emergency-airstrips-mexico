// Planning Emergency Airstrips in Mexico — copied 23-Nov-2026 from Mexican Airstrips for your EFB and Sim (airfield-kml-builder repo,
// netlify/functions/terrain.js, v0.94); keep the two in step. Original notes:
// Mexican Airstrips for your EFB and Sim — v0.67: terrain tiles for the visual approaches' terrain check.
//
// Passes through one Terrarium-encoded elevation tile from the AWS Open Data "Terrain Tiles" dataset
// (Mapzen / Linux Foundation; https://registry.opendata.aws/terrain-tiles, free, no key) so the page can read
// its pixels from its own origin (a canvas can't read a cross-origin image without CORS headers).
// Elevation in meters = (R * 256 + G + B / 256) - 32768. Tiles never change, so they're cached hard.
// No npm packages (App Conventions §1).
//
// GET /.netlify/functions/terrain?z=12&x=<tile x>&y=<tile y>

const SRC = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  const z = parseInt(q.z, 10), x = parseInt(q.x, 10), y = parseInt(q.y, 10);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 15 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Bad tile address' };
  }
  try {
    const res = await fetch(`${SRC}/${z}/${x}/${y}.png`);
    if (!res.ok) throw new Error('terrain source answered ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=2592000, immutable' },
      body: buf.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: 'Terrain tile unavailable: ' + e.message };
  }
};
