"""Procedurally draw and pipe 1,800 frames to ffmpeg. Coordinates: 1080x1920."""
import os,sys,math,subprocess,argparse,time
import imageio_ffmpeg
from PIL import Image,ImageDraw
import bpm_clock as clock
from draw_common import *
from captions import build_cards,draw_caption
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def clamp(x):return max(0,min(1,x))
def draw(t,ctx,bg,heart,cards):
    if t >= 59.7: t = 0.0  # visually identical loop endpoint
    s=ctx['s']; im=bg.copy(); d=ImageDraw.Draw(im,'RGBA'); b=clock.bpm(t); ph=clock.phase(t)
    def rect(x,y,w,h,col,r=0,outline=None):
        d.rounded_rectangle((x*s,y*s,(x+w)*s,(y+h)*s),radius=r*s,fill=col,outline=outline,width=max(1,int(2*s)))
    def line(points,col,width=3):d.line([(x*s,y*s) for x,y in points],fill=col,width=max(1,int(width*s)),joint='curve')
    def ellipse(x,y,w,h,col,outline=None,width=2):d.ellipse((x*s,y*s,(x+w)*s,(y+h)*s),fill=col,outline=outline,width=max(1,int(width*s)))
    def text(x,y,txt,size=42,col=WHITE,fam='montserrat'):text_center(im,ctx,x,y,txt,fam,size,col,800)
    def label(x,y,txt,size=27,col=SECONDARY):text_left(im,ctx,x,y,txt,'inter',size,col,700)
    def heart_at(x,y,scale=1):
        amp=clock.pulse_amp(b); pulse=clock.pulse_shape(ph,b)*amp
        # Quantization retains smooth but avoids huge cache of raster sizes.
        scale=round((scale*(1+pulse))*100)/100
        if scale not in ctx['hearts']:
            ctx['hearts'][scale]=heart.resize((int(heart.width*scale),int(heart.height*scale)),Image.Resampling.BILINEAR)
        paste_center(im,ctx['hearts'][scale],x,y)
    scene=0 if t<4 else 1 if t<10 else 2 if t<17 else 3 if t<25 else 4 if t<32 else 5 if t<39 else 6 if t<47 else 7 if t<55 else 8
    # Stable safe frame and the same heart asset for all heart scenes.
    if scene in (0,8):
        # Identical first/last composition: text is removed at either edge.
        p=clamp(t/4) if scene==0 else clamp((60-t)/5)
        hs=.82+(.10*clamp(t/4) if scene==0 else .10*p)
        if 1.9<t<2.55:hs+=.05*math.sin(math.pi*clamp((t-1.9)/.65))
        heart_at(500,665,hs)
        draw_ecg(im,ctx,t,110,1150,780,100,b,window=2.5)
        if scene==0 and t>.5:
            text(500,940, '350 BPM' if t>=2.4 else '70 BPM',72, DANGER if t>=2.4 else WHITE,'mono')
            if t>2.15:text(500,1035,'x5',60,AMBER)
        if scene==8 and 55.3<t<59.25:
            text(500,960,'Your heart keeps time.',52,WHITE)
            text(500,1050,'Follow for more What Ifs',38,CYAN)
            text(500,1200,'Hypothetical scenario. Not medical advice.',26,SECONDARY,'inter')
    elif scene==1:
        heart_at(500,625,.72)
        # timer ring
        d.ellipse((180*s,305*s,820*s,945*s),outline=(72,99,129,100),width=max(1,int(3*s)))
        d.arc((180*s,305*s,820*s,945*s),-90,-90+int(360*ph),fill=(*CYAN,220),width=max(2,int(7*s)))
        text(500,980,'Resting: ~70 BPM',48,WHITE)
        text(500,1050,'0.86 s per beat',38,CYAN,'mono')
        text(500,1160,'70 x 5 = 350',62,AMBER,'mono')
    elif scene==2:
        heart_at(500,610,.53)
        cx,cy,r=500,900,355
        d.arc(((cx-r)*s,(cy-r)*s,(cx+r)*s,(cy+r)*s),180,360,fill=(59,69,84,255),width=max(2,int(22*s)))
        d.arc(((cx-r)*s,(cy-r)*s,(cx+r)*s,(cy+r)*s),180,225,fill=(*CYAN,255),width=max(2,int(22*s)))
        d.arc(((cx-r)*s,(cy-r)*s,(cx+r)*s,(cy+r)*s),225,320,fill=(*AMBER,255),width=max(2,int(22*s)))
        a=math.pi+(clamp((b-60)/160))*math.pi
        line([(cx,cy),(cx+310*math.cos(a),cy+310*math.sin(a))],(*WHITE,230),6);ellipse(cx-12,cy-12,24,24,(*CORAL,255))
        label(150,916,'REST 60–100',25,CYAN);label(618,916,'EXERCISE',25,AMBER)
        text(500,1040,'Hard exercise ~ 190 BPM',44,WHITE)
        text(500,1110,'(young adult, estimate)',29,SECONDARY,'inter')
        draw_ecg(im,ctx,t,150,1230,700,60,b)
    elif scene==3:
        heart_at(500,610,.8)
        # Cutaway chamber: animated, illustrative level.
        ellipse(440,530,220,260,(15,20,34,230),(*CORAL,230),5)
        level=clamp(1-(b-70)/330)*.75+.08
        ellipse(465,555+185*(1-level),170,185*level,(213,29,45,235))
        label(415,817,'VENTRICLE',27,SECONDARY)
        text(500,938,'Less time to fill',53,WHITE)
        for j,(v,dur,leng,col) in enumerate([('70 BPM','0.86 s',1,CYAN),('190 BPM','0.32 s',.37,AMBER),('350 BPM','0.17 s',.20,DANGER)]):
            y=1005+j*77;label(95,y,v,28,col);rect(290,y+9,360,18,(42,50,65,255),9);rect(290,y+9,360*leng,18,(*col,255),9);label(690,y,dur,30,WHITE)
    elif scene==4:
        # Translucent artery with continuously flowing particles.
        d.polygon([(120*s,365*s),(880*s,365*s),(800*s,880*s),(200*s,880*s)],fill=(75,15,27,160))
        for k in range(4):
            line([(120+k*25,365),(200+k*16,880)],(255,75,85,100),3)
            line([(880-k*25,365),(800-k*16,880)],(255,75,85,100),3)
        for k in range(25):
            x=220+((k*173)%560); y=390+((k*113+(t-25)*150)%450); rad=10+(k%3)*4
            ellipse(x-rad,y-rad,rad*2,rad*2,(230,65,75,110))
        text(500,970,'Less filling →',49,WHITE);text(500,1035,'less blood per beat',49,WHITE)
        for j,(lab,v) in enumerate([('BLOOD PER BEAT',.75-.40*clamp((t-25)/7)),('PRESSURE',.8-.47*clamp((t-25)/7))]):
            y=1110+j*77;label(100,y,lab,26,SECONDARY);rect(420,y+8,410,19,(43,50,65,255),9);rect(420,y+8,410*v,19,(*AMBER,255),9)
        text(500,1260,'Pressure can fall',35,AMBER)
    elif scene==5:
        # Head and brain, fading with reduced blood flow.
        d.polygon([(375*s,860*s),(350*s,740*s),(285*s,700*s),(330*s,650*s),(320*s,525*s),(355*s,405*s),(450*s,340*s),(610*s,350*s),(700*s,440*s),(715*s,590*s),(660*s,720*s),(655*s,860*s)],fill=(40,70,90,130),outline=(90,160,175,180),width=max(2,int(4*s)))
        fade=1-.75*clamp((t-32)/7)
        for k in range(8):
            x=400+(k%4)*48;y=440+(k//4)*55
            ellipse(x,y,100,95,(40,210,220,int(140*fade)),(90,230,235,int(170*fade)),3)
        for k,word in enumerate(['Dizziness','Tunnel vision','Fainting']):
            if t>32.4+k*1.4:text(500,970+k*65,word,47,WHITE if k<2 else AMBER)
        text(500,1200,'Low blood flow to the brain',38,CYAN)
        if t>36:
            # Vignette: no full-frame flashing.
            border=int((t-36)*32*s);d.rounded_rectangle((0,310*s,1080*s,900*s),radius=180*s,outline=(0,0,0,200),width=max(1,border))
    elif scene==6:
        heart_at(500,630,.91)
        for k in range(5):
            x=280+k*90
            line([(500,430),(x+40,540),(x,640),(x+30,715)],(245,130,125,110),4)
        text(500,969,'Heart muscle gets most',43,WHITE)
        text(500,1030,'of its blood while relaxing',43,WHITE)
        text(500,1110,'Rhythm can collapse',45,AMBER)
        draw_ecg(im,ctx,t,115,1230,770,80,b,chaotic=True,window=2)
    elif scene==7:
        # Vector hummingbird silhouette and wing (continuous movement).
        y=520+12*math.sin((t-47)*2); wing=38*math.sin((t-47)*18)
        d.polygon([(390*s,(y+10)*s),(290*s,(y-160+wing)*s),(485*s,(y-50)*s)],fill=(44,174,180,160))
        d.ellipse((350*s,(y-70)*s,620*s,(y+120)*s),fill=(46,136,153,255),outline=(*CYAN,200),width=max(2,int(4*s)))
        ellipse(570,y-110,115,112,(59,155,169,255));d.polygon([(665*s,(y-80)*s),(820*s,(y-115)*s),(675*s,(y-52)*s)],fill=(*SECONDARY,255))
        d.polygon([(355*s,(y+30)*s),(215*s,(y+125)*s),(390*s,(y+83)*s)],fill=(62,125,143,255))
        ellipse(478,y-9,32,32,(*CORAL,255))
        text(500,800,'Hummingbird: 1,000+ BPM',43,WHITE);text(500,865,'Built for it.',43,CYAN)
        xvals=[220,430,680]; heights=[22,59,310];cols=[CYAN,AMBER,CORAL]
        for x,h,col in zip(xvals,heights,cols):rect(x,1225-h,110,h,(*col,235),8)
        for i in range(13):line([(125+i*56,1118),(150+i*56,1118)],(255,255,255,180),2)
        text(500,1085,'your 5x heart: 350',28,WHITE,'mono')
        for x,lab in zip(xvals,['REST ~70','PEAK ~190','1,000+']):text(x+55,1250,lab,22,SECONDARY,'mono')
    # Gentle dip around selected scene changes; avoid full-frame flashes.
    for cut in (10,17,25,32,39,55):
        distance=abs(t-cut)
        if distance < .18:
            fade_to_black(im, int(58*(1-distance/.18)))
    draw_bpm_counter(im,ctx,b)
    draw_caption(im,ctx,cards,t)
    return im.convert('RGB')

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--width',type=int,default=540);ap.add_argument('--output',required=True);ap.add_argument('--testframes',action='store_true');args=ap.parse_args()
    ctx={'s':args.width/1080,'hearts':{}}; bg=make_background(ctx); heart=make_heart_sprite(ctx);cards=build_cards()
    if args.testframes:
        os.makedirs(os.path.join(ROOT,'build','frames'),exist_ok=True)
        for t in [0,2.5,4,7,10,13.5,17,21,25,28.5,32,35.5,39,43,47,51,55,57,59.9667]:
            draw(t,ctx,bg,heart,cards).save(os.path.join(ROOT,'build','frames',f'{t:05.2f}.jpg'))
        return
    ff=imageio_ffmpeg.get_ffmpeg_exe(); w=args.width;h=w*16//9
    cmd=[ff,'-y','-v','warning','-f','rawvideo','-pix_fmt','rgb24','-s',f'{w}x{h}','-r','30','-i','-','-i',os.path.join(ROOT,'build','mix.wav'),'-filter:a','loudnorm=I=-14:TP=-1.5:LRA=11','-c:v','libx264','-preset','veryfast','-profile:v','high','-pix_fmt','yuv420p','-b:v','12M' if w==1080 else '3M',*(['-minrate','12M','-maxrate','12M','-bufsize','24M','-x264-params','nal-hrd=cbr:force-cfr=1'] if w==1080 else []),'-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart','-t','60',args.output]
    p=subprocess.Popen(cmd,stdin=subprocess.PIPE);start=time.time()
    for i in range(1800):
        p.stdin.write(draw(i/30,ctx,bg,heart,cards).tobytes())
        if i%150==0: print(f'{i}/1800 {time.time()-start:.0f}s',flush=True)
    p.stdin.close();rc=p.wait();print('exit',rc);sys.exit(rc)
if __name__=='__main__':main()
