"""Original synthetic music and BPM-synchronous thumps plus local narration."""
import json,os,math,wave
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter,sosfilt
import bpm_clock
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); B=os.path.join(ROOT,'build'); VO=os.path.join(ROOT,'assets','narration'); SR=48000; N=60*SR

def main():
    os.makedirs(B,exist_ok=True)
    rng=np.random.default_rng(33); time=np.arange(N,dtype=np.float32)/SR
    vo=np.zeros(N,dtype=np.float32); active=np.zeros(N,dtype=np.float32)
    for line in json.load(open(os.path.join(VO,'vo_manifest.json'))):
        sr,a=wavfile.read(os.path.join(VO,line['file'])); a=a.astype(np.float32)/32768
        a=sosfilt(butter(2,80,fs=SR,btype='highpass',output='sos'),a).astype('float32')
        # gentle saturation controls Flite peaks
        a=np.tanh(a*1.5)*0.53
        i=int(line['start']*SR); vo[i:i+len(a)]+=a[:N-i]; active[max(0,i-int(.1*SR)):min(N,i+len(a)+int(.12*SR))]=1
    # Soft duck envelope with 40 ms attack/release.
    duck=sosfilt(butter(2,4,fs=SR,output='sos'),active).clip(0,1)
    env=np.interp(time,[0,2,10,17,32,39,46.4,46.9,47.1,55,59,60],[.03,.09,.11,.18,.12,.14,.04,.002,.07,.10,.08,.005])
    music=env*(.55*np.sin(2*np.pi*55*time)+.17*np.sin(2*np.pi*110*time)+.18*np.sin(2*np.pi*82.41*time)+.12*np.sin(2*np.pi*164.82*time))
    music*=1-.65*duck
    heart=np.zeros(N,dtype=np.float32)
    for bt in bpm_clock.beat_times():
        b=bpm_clock.bpm(bt); vol=.10 if b<150 else .05
        for offset,freq,amp in [(0,55,1),(.13 if b<150 else .045,70,.55)]:
            length=int((.14 if b<150 else .06)*SR); j=int((bt+offset)*SR); n=min(length,N-j)
            if n<=0:continue
            tt=np.arange(n)/SR
            sound=np.sin(2*np.pi*freq*tt)*np.exp(-tt*32)+.08*rng.standard_normal(n)*np.exp(-tt*110)
            heart[j:j+n]+=vol*amp*sound
    heart*=1-.35*duck
    # Rest near-silence at the S7 transition.
    heart[int(46.5*SR):int(47*SR)]*=0.04
    out=(vo+music+heart).astype(np.float32)
    wavfile.write(os.path.join(B,'mix.wav'),SR,np.stack([out,out],axis=1))
    print('mix peak',np.max(np.abs(out)))
if __name__=='__main__':main()
