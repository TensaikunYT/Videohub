// Per-shot sound levels set in the scene editor (tweaks.json "sound") put into the film's mix, the file the live
// preview plays and renders mux:
//   studio  3D studio scene: the engine builds its mix itself (node make.mjs <scene> --audio reads tweaks.json)
//   stems   a mix with music.wav + sfx.wav beside it (spotlight-shorts score): rebuilt from the untouched mix + stems
//   all     any other WAV mix: one overall level per shot
// The untouched mix is kept as <mix>.vhorig.wav. When the film's own score writes a new mix (newer than VideoHub's
// last write), that new one becomes the untouched mix. No sound entries left = the untouched mix is put back.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readWav, writeWav, remix, replaceFile, clipsOf, mixClips, mixKey } from './vhsound.mjs';
import { TOOLS, isInside } from './util.js';
import { audioOf, quietFile } from './live.js';
import { readJson, writeJson } from './util.js';
import { readTweaksStrict } from './tweaks.js';

const vh = (p) => path.join(p.path, '.videohub');
export function soundInfo(p) {
  if (p.studio) {
    // stale: the engine's last mix was built with other levels / clips than tweaks.json has now (its .vh key, make.mjs)
    const target = path.join(p.outDir, 'audio.wav');
    let stale = false;
    try { const tw = readTweaksStrict(path.join(p.path, 'tweaks.json')); stale = fs.existsSync(target) && (fs.existsSync(target + '.vh') ? fs.readFileSync(target + '.vh', 'utf8') : '[]') !== mixKey(tw.sound || [], clipsOf(tw)); } catch { }
    return { mode: 'studio', channels: ['music', 'sfx', 'vo', 'all'], target, stale };
  }
  const target = audioOf(p, readJson(path.join(vh(p), 'project.json'), {}));
  if (!target || !/\.wav$/i.test(target)) return { mode: 'none', channels: [], reason: target ? 'the film audio is not a WAV file' : 'the film has no audio file' };
  // stems next to the mix: spotlight music/sfx.wav, paper-hands st_bed/st_sfx.wav
  const dir = path.dirname(target), pick = (...n) => n.map((x) => path.join(dir, x)).find((f) => fs.existsSync(f)) || path.join(dir, n[0]);
  const music = pick('music.wav', 'st_bed.wav'), sfx = pick('sfx.wav', 'st_sfx.wav');
  const stems = fs.existsSync(music) && fs.existsSync(sfx);
  return { mode: stems ? 'stems' : 'all', channels: stems ? ['music', 'sfx', 'vo', 'all'] : ['all'], target, music, sfx };
}

// the line that says what went wrong (a Node crash ends with its version line, which said nothing)
export function errLine(err, code) {
  const L = String(err || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^at /.test(l) && !/^Node\.js v/.test(l));
  return L.find((l) => /(Error|error|hata)\b/.test(l)) || L.pop() || 'code ' + code;
}
// one build per film at a time; a call while one runs gets the next build (made once, after the running one), so a
// change saved during a build is always built once more and every caller waits for the build that has its change
const busy = new Map(), again = new Map();
export function applySound(p) {
  const cur = busy.get(p.id);
  if (cur) {
    let nx = again.get(p.id);
    if (!nx) { nx = cur.catch(() => { }).then(() => { again.delete(p.id); return startSound(p); }); again.set(p.id, nx); }
    return nx;
  }
  return startSound(p);
}
function startSound(p) {
  const job = (async () => {
    // the stems / all build is synchronous: start it on the next turn, so calls arriving together join this one
    await new Promise((r) => setImmediate(r));
    const info = soundInfo(p), t0 = Date.now();
    if (info.mode === 'none') throw Object.assign(new Error(info.reason), { code: 400 });
    if (info.mode === 'studio') {
      // the engine's own audio build reads the levels (engine/audio/vhsound.mjs); one at a time, hidden
      await new Promise((ok, no) => {
        const c = spawn(process.execPath, ['make.mjs', path.basename(p.path), '--audio'], { cwd: p.studio, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let err = ''; c.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
        c.on('error', no); c.on('exit', (code) => code === 0 ? ok() : no(new Error('could not build audio: ' + errLine(err, code))));
      });
      return { ok: true, mode: 'studio', ms: Date.now() - t0, note: 'the engine rebuilt the audio' };
    }
    const orig = info.target.replace(/\.wav$/i, '.vhorig.wav'), recF = path.join(vh(p), 'sound.json'), rec = readJson(recF, {});
    quietFile(info.target, 30000);   // the preview must not reload for our own write
    const st = fs.statSync(info.target);
    if (!fs.existsSync(orig) || !rec.written || Math.abs(st.mtimeMs - rec.written) > 1500) fs.copyFileSync(info.target, orig);   // first time, or the score made a new mix
    // strict: a half-written or broken file must not read as 'no levels' (that would put the untouched mix back)
    let tw; try { tw = readTweaksStrict(path.join(p.path, 'tweaks.json')); } catch (e) { throw Object.assign(new Error('could not read tweaks.json'), { code: 409 }); }
    const entries = (tw.sound || []).filter((e) => e && +e.t1 > +e.t0), clips = clipsOf(tw);
    let note = 'original audio restored';
    if (!entries.length && !clips.length) { const tmp = info.target + '.vhtmp'; fs.copyFileSync(orig, tmp); replaceFile(tmp, info.target); }
    else {
      const P = readWav(orig), stems = info.mode === 'stems' ? { music: readWav(info.music), sfx: readWav(info.sfx) } : null;
      let mix = { sr: P.sr, ch: P.ch.map((c) => new Float32Array(c)), bits: P.bits };
      if (entries.length) { const r = remix(P, stems, entries); mix = r.mix; note = r.note; } else note = 'original audio';
      // added clips (vhaudio/…) on top, after the levels
      const n = clips.length ? mixClips(mix, clips, (src) => { const f = path.join(p.path, src); return isInside(f, p.path) ? f : null; }, TOOLS.ffmpeg) : 0;
      if (n) note += ` + ${n} added sounds`;
      writeWav(info.target, mix);
    }
    fs.mkdirSync(vh(p), { recursive: true });
    writeJson(recF, { written: fs.statSync(info.target).mtimeMs, orig: path.basename(orig), entries: entries.length, clips: clips.length, at: new Date().toISOString() });
    return { ok: true, mode: info.mode, ms: Date.now() - t0, note };
  })();
  busy.set(p.id, job);
  const done = () => { if (busy.get(p.id) === job) busy.delete(p.id); };
  job.then(done, done);
  return job;
}

export function routes(route, project) {
  const need = (id) => { const p = project(id); if (!p) throw Object.assign(new Error('Project not found'), { code: 404 }); return p; };
  route('GET', '/api/project/:id/sound-info', (req, url, { id }) => { const { target, music, sfx, ...r } = soundInfo(need(id)); return r; });
  route('POST', '/api/project/:id/sound-apply', (req, url, { id }) => applySound(need(id)));
}
