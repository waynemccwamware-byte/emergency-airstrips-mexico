# Planning Emergency Airstrips in Mexico

A GeezerGeek Pilot app (companion to [Mexican Airstrips for your EFB and Sim](https://airfield-kml-builder.netlify.app/)).
Enter a route across Mexico and see the airstrips along it, filtered by runway length, surface and permit.

- `site/index.html` — the whole app (CSS and JS inline, App Conventions §2). Shared footer blocks come from the Control Panel repo's footer master.
- `netlify/functions/afac.js` — AFAC's "Aeródromos y helipuertos" list as JSON (copied from Mexican Airstrips; keep the two in step).
- `site/data/mx-icao.json` — Mexico's ICAO airports (copied from Mexican Airstrips).
- `site/data/navaids.json`, `site/data/us-airports.json` — OurAirports navaids and US Southwest airports, built by `tools/build-data.py`.

## Offline use

This app runs on the web and needs a connection: its maps, AFAC data, runway lookups, terrain checks and pack building all come from the web. Nothing is kept for offline use. Plan on the ground, send the results to ForeFlight, finish the install (More → Custom Content → Install), and check them in airplane mode before you go. Only the airstrips you ticked go in the pack; each waypoint's PDF record is a snapshot from the day it was built.

Not for navigation.
