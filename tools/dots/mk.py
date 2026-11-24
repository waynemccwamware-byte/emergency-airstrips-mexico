from PIL import Image, ImageDraw
import base64, json
S=64; K=8
def dot(fill, ring=(20,20,20,255)):
    big=Image.new('RGBA',(S*K,S*K),(0,0,0,0)); d=ImageDraw.Draw(big)
    m=2*K; d.ellipse([m,m,S*K-m-1,S*K-m-1],fill=ring)
    r=8*K; d.ellipse([r,r,S*K-r-1,S*K-r-1],fill=fill)
    return big.resize((S,S),Image.LANCZOS)
cols={'white':(255,255,255,255),'amber':(0xff,0xb0,0x00,255),'red':(0xe0,0x70,0x5f,255),'orange':(0xff,0x7a,0x1a,255)}
out={}
for n,c in cols.items():
    im=dot(c); fn=f'ggp-dot-{n}.png'; im.save(fn,optimize=True)
    out[fn]=base64.b64encode(open(fn,'rb').read()).decode()
json.dump(out,open('dots.json','w'))
print({k:len(v) for k,v in out.items()})  # then gen_js.py → paste DOT_PNG into netlify/functions/pack.js (both airstrip apps)
