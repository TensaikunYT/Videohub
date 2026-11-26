"""Estimated word timing and SRT; no aligner is available."""
import json,os
from PIL import ImageDraw
from draw_common import font, WHITE, CORAL
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def build_cards():
    with open(os.path.join(ROOT,'assets','narration','vo_manifest.json')) as f: lines=json.load(f)
    cards=[]
    for line in lines:
        words=line['words']
        for i in range(0,len(words),4):
            part=words[i:i+4]
            cards.append({'start':part[0][0],'end':part[-1][1],'words':[(w,s,e) for s,e,w in part]})
    return cards

def write_srt(cards,path):
    def stamp(t):
        ms=round(t*1000); return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
    with open(path,'w') as f:
        for i,c in enumerate(cards,1):
            f.write(f"{i}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{' '.join(w for w,_,_ in c['words'])}\n\n")

def draw_caption(img,ctx,cards,t):
    card=next((c for c in cards if c['start']<=t<c['end']),None)
    if not card:return
    s=ctx['s']; d=ImageDraw.Draw(img,'RGBA'); f=font('montserrat',64*s,800)
    words=card['words']; space=d.textlength(' ',font=f); lines=[]; line=[]; width=0
    for item in words:
        w=d.textlength(item[0],font=f)
        if line and width+space+w>840*s: lines.append(line); line=[]; width=0
        line.append(item); width+=w+(space if len(line)>1 else 0)
    if line:lines.append(line)
    d.rounded_rectangle((64*s,1300*s,936*s,1460*s),radius=15*s,fill=(5,8,14,215))
    for j,line in enumerate(lines):
        widths=[d.textlength(w,font=f) for w,_,_ in line]; x=500*s-(sum(widths)+space*(len(line)-1))/2
        y=(1330+(j-(len(lines)-1)/2)*70)*s
        for (w,a,b),wd in zip(line,widths):
            d.text((x+2*s,y+2*s),w,font=f,fill=(0,0,0,255),stroke_width=max(1,int(1*s)))
            d.text((x,y),w,font=f,fill=(* (CORAL if a<=t<b else WHITE),255))
            x+=wd+space

if __name__ == '__main__':
    dest=os.path.join(os.path.dirname(ROOT),'out','captions.srt')
    os.makedirs(os.path.dirname(dest),exist_ok=True)
    write_srt(build_cards(),dest)
