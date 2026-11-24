import json
d=json.load(open('dots.json'))
lines=["// v0.98 / v0.10 (24-Nov-2026): small dot icons for the pack's map-layer points (Wayne: keep the airstrip pin, the rest small dots).",
"// 64 px PNGs, colored fill with a dark ring (tools/dots/mk.py). A layers/*.kml whose styles point at files/ggp-dot-*.png goes into",
"// the pack as a .kmz (doc.kml + files/) — ForeFlight takes custom icons only from a KMZ (support article 115006023427).",
"const DOT_PNG = {"]
for k,v in d.items(): lines.append(f"  '{k}': '{v}',")
lines.append("};")
open('dots.js.txt','w').write("\n".join(lines)+"\n")
