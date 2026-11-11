// Scene tweaks: small fixes the user makes in VideoHub's live editor, with no code change and no Claude.
// They live in scenes/<name>/tweaks.json and every frame (preview and render alike) is drawn with them:
//
//   { "v": 1, "shots": { "<shot name or *>": {
//       "camera":  { "dp": [x,y,z], "dq": [x,y,z,w], "fov": 50 },     // relative to the shot's own camera (its motion stays)
//       "objects": { "<path>": { "dp": [x,y,z], "ry": deg, "s": k, "hide": true } },
//       "overlays": { "<item id>": { "dx": px, "dy": px, "s": k, "cx": px, "cy": px, "hide": true } } } },   // 1920x1080 px
//     "cuts": [ { "at": 83.25, "d": -0.1 } ] }     // a cut (source time) shown d s earlier/later; the sound stays
//
// "*" applies to the whole film; a shot name only while that shot plays (window.__qaShot). An object's path is its
// chain of names from the scene root (unnamed ones by "#index"). After the scene's frame code the tweaks are put on,
// and before the next frame they are taken off again, so a scene that sets something only once is not moved twice.
// window.VH_EDIT is what the editor uses: pick an object, steer a free camera, change and save the tweaks.
import * as THREE from 'three';

const V = new THREE.Vector3(), V2 = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler();

export async function loadTweaks(url) {
  try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (j && j.shots) return j; } } catch { }
  return { v: 1, shots: {} };
}

// Engines with one scene and camera pass them once; engines that draw several slots per frame (a cross-fade: two sets,
// two cameras) call apply({ scene, camera, shot, main }) for each slot after its own update. shotName() is the shot on
// screen; shotAt(s) (optional) names the shot at a source time cheaply, else findCut steps the scene with step(s).
export function makeTweaks({ scene, camera, data, redraw, now = () => 0, step = () => { }, fps = 60, shotName = null, shotAt = null }) {
  data.cuts = data.cuts || []; data.sound = data.sound || [];
  let curShot = null, mainShot = '', lastCam = { tw: null, free: null };
  let applied = [];          // what was changed this frame, to take back
  let free = null;           // editor's free camera { pos, quat, fov, target }
  const orig = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: camera ? camera.fov : 50 };   // the shot's own camera this frame
  const cache = new Map();
  const nameNow = () => (shotName ? shotName() : window.__qaShot && window.__qaShot()) || '';
  const shot = () => curShot ?? nameNow();

  function pathOf(o) {
    const segs = [];
    for (let a = o; a && a !== scene; a = a.parent) {
      const p = a.parent; if (!p) return null;
      if (a.name) { const same = p.children.filter((c) => c.name === a.name); segs.push(same.length > 1 ? `${a.name}[${same.indexOf(a)}]` : a.name); }
      else segs.push('#' + p.children.indexOf(a));
    }
    return segs.reverse().join('/');
  }
  function find(path) {
    const ck = scene.uuid + '|' + path, c = cache.get(ck);
    if (c && c.parent && pathOf(c) === path) return c;
    let o = scene;
    for (const seg of path.split('/')) {
      if (!o) break;
      if (seg[0] === '#') { o = o.children[+seg.slice(1)]; continue; }
      const m = /^(.*)\[(\d+)\]$/.exec(seg);
      o = m ? o.children.filter((ch) => ch.name === m[1])[+m[2]] : o.children.find((ch) => ch.name === seg);
    }
    if (o && o !== scene) cache.set(ck, o); else cache.delete(ck);
    return o && o !== scene ? o : null;
  }
  const entries = () => [data.shots['*'], data.shots[shot()]].filter(Boolean);

  // ---- per frame
  function restore() {
    for (let i = applied.length - 1; i >= 0; i--) {
      const a = applied[i];
      a.o.position.copy(a.pos); a.o.quaternion.copy(a.quat); a.o.scale.copy(a.scale); a.o.visible = a.vis;
      if (a.cam) { a.o.fov = a.fov; a.o.updateProjectionMatrix(); }
    }
    applied = [];
  }
  function keep(o, cam) { applied.push({ o, cam, pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.clone(), vis: o.visible, fov: cam ? o.fov : 0 }); }
  function apply(slot) {
    if (slot) { scene = slot.scene; camera = slot.camera; curShot = slot.shot ?? null; } else curShot = null;
    const main = !slot || slot.main !== false;
    if (main) { mainShot = shot(); orig.pos.copy(camera.position); orig.quat.copy(camera.quaternion); orig.fov = camera.fov; }
    let camTweak = null;
    for (const e of entries()) {
      if (e.camera) camTweak = e.camera;     // a shot's own camera wins over the whole-film one
      for (const [path, d] of Object.entries(e.objects || {})) {
        const o = find(path); if (!o || (d.t && o.type !== d.t)) continue;   // the scene changed shape: never move the wrong thing
        keep(o, false);
        if (d.dp) o.position.add(V.fromArray(d.dp));
        if (d.ry) o.quaternion.premultiply(Q.setFromAxisAngle(V.set(0, 1, 0), d.ry * Math.PI / 180));
        if (d.s && d.s !== 1) o.scale.multiplyScalar(d.s);
        if (d.hide) o.visible = false;
      }
    }
    const fr = main ? free : null;
    lastCam = { tw: camTweak, free: fr ? camera : null };
    if (camTweak || fr) {
      keep(camera, true);
      if (camTweak) {
        if (camTweak.dp) camera.position.add(V.fromArray(camTweak.dp).applyQuaternion(orig.quat));
        if (camTweak.dq) camera.quaternion.multiply(Q.fromArray(camTweak.dq));
        if (camTweak.fov) camera.fov = camTweak.fov;
      }
      if (fr) { camera.position.copy(fr.pos); camera.quaternion.copy(fr.quat); camera.fov = fr.fov; }
      camera.updateProjectionMatrix();
    }
  }

  // ---- editor API
  const ray = new THREE.Raycaster();
  function hitAt(nx, ny, skip) {
    camera.updateMatrixWorld(true);
    ray.setFromCamera({ x: nx, y: ny }, camera);
    const hits = ray.intersectObjects(scene.children, true);
    for (const h of hits) {
      const o = h.object;
      if (!o.isMesh || skip?.(o)) continue;
      let vis = true; for (let a = o; a; a = a.parent) if (!a.visible) { vis = false; break; }
      if (!vis) continue;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && (m.transparent && m.opacity < 0.3 || m.blending === THREE.AdditiveBlending)) continue;
      if (o.userData.qaIgnore || o === window.__vhSky) continue;
      return h;
    }
    return null;
  }
  function describe(o) {
    const box = new THREE.Box3().setFromObject(o);
    const corners = [];
    if (!box.isEmpty()) for (let i = 0; i < 8; i++) corners.push(V.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).clone().project(camera));
    const inFront = corners.filter((c) => c.z < 1);
    const rect = inFront.length ? [Math.min(...inFront.map((c) => c.x)), Math.min(...inFront.map((c) => c.y)), Math.max(...inFront.map((c) => c.x)), Math.max(...inFront.map((c) => c.y))] : null;
    const size = box.isEmpty() ? [0, 0, 0] : box.getSize(V2).toArray().map((n) => +n.toFixed(2));
    return { path: pathOf(o), name: o.name || '', type: o.type, size, rect };
  }
  function tw(key, create) {
    if (!data.shots[key]) { if (!create) return null; data.shots[key] = {}; }
    return data.shots[key];
  }
  function objTweak(key, path, create = true) {
    const s = tw(key, create); if (!s) return null;
    s.objects = s.objects || {};
    if (!s.objects[path] && create) s.objects[path] = { t: find(path)?.type };
    return s.objects[path] || null;
  }
  function tidy() {
    for (const [k, s] of Object.entries(data.shots)) {
      for (const [p, d] of Object.entries(s.objects || {})) {
        if (d.dp && d.dp.every((n) => Math.abs(n) < 1e-4)) delete d.dp;
        if (!d.ry) delete d.ry; if (!d.s || Math.abs(d.s - 1) < 1e-4) delete d.s; if (!d.hide) delete d.hide;
        if (!Object.keys(d).filter((k) => k !== 't').length) delete s.objects[p];
      }
      if (s.objects && !Object.keys(s.objects).length) delete s.objects;
      for (const [id, o] of Object.entries(s.overlays || {})) {
        if (!o.dx) delete o.dx; if (!o.dy) delete o.dy; if (!o.hide) delete o.hide;
        if (!o.s || Math.abs(o.s - 1) < 1e-3) { delete o.s; delete o.cx; delete o.cy; }
        if (!Object.keys(o).length) delete s.overlays[id];
      }
      if (s.overlays && !Object.keys(s.overlays).length) delete s.overlays;
      if (!Object.keys(s).length) delete data.shots[k];
    }
    data.cuts = data.cuts.filter((c) => Math.abs(c.d) > 1e-4).sort((a, b) => a.at - b.at);
  }
  const r3 = (a) => a.map((n) => +n.toFixed(4));

  // ---- cuts: a cut moved by d s; the film time around it is stretched (the shot before plays a little faster or
  // slower, the one after too) so the cut lands d s earlier/later while the sound stays where it is
  const cutW = (d) => Math.max(0.6, Math.abs(d) * 2.5);
  function time(t) {
    let s = t;
    for (const { at, d } of data.cuts) {
      const W = cutW(d);
      if (!d || s <= at - W || s >= at + W) continue;
      s = s < at + d ? at - W + (s - (at - W)) * W / (W + d) : at + (s - at - d) * W / (W - d);
    }
    return s;
  }
  // ---- screen items (engine/overlay.js asks while it draws): the shot's own tweak wins over the whole film's
  window.__vhOverlayTweak = (id) => { let r = null; for (const e of entries()) if (e.overlays && e.overlays[id]) r = e.overlays[id]; return r; };
  function ovTweak(key, id) { const s = tw(key, true); s.overlays = s.overlays || {}; return (s.overlays[id] = s.overlays[id] || {}); }

  window.VH_EDIT = {
    v: 3,
    shot: () => mainShot || nameNow(),
    caps: () => ({ overlays: !!(window.__vhOverlays && window.__vhOverlays.length), cuts: true, sound: true }),
    get: () => JSON.parse(JSON.stringify(data)),
    set(d) { data.shots = (d && d.shots) || {}; data.cuts = (d && d.cuts) || []; data.sound = (d && d.sound) || []; cache.clear(); redraw(); },
    // ---- sound: per-shot levels, applied to the mix by VideoHub (stems) — the page only keeps them
    soundSet(entry) { data.sound = data.sound.filter((x) => x.shot !== entry.shot); if (['music', 'sfx', 'vo', 'all'].some((k) => entry[k] != null && Math.abs(entry[k] - 1) > 1e-3)) data.sound.push(entry); data.sound.sort((a, b) => a.t0 - b.t0); },
    // ---- screen items: what was drawn this frame, each with its box (1920x1080 px, after its tweak)
    overlays() { const out = []; for (const ov of window.__vhOverlays || []) try { out.push(...ov.inspect()); } catch { } return out; },
    ovMove(key, id, dx, dy) { const o = ovTweak(key, id); o.dx = +((o.dx || 0) + dx).toFixed(1); o.dy = +((o.dy || 0) + dy).toFixed(1); tidy(); redraw(); },
    // size around the item's own centre (box centre on screen, before its move)
    ovScale(key, id, k, cx, cy) { const o = ovTweak(key, id); if (o.cx == null) { o.cx = +(cx - (o.dx || 0)).toFixed(1); o.cy = +(cy - (o.dy || 0)).toFixed(1); } o.s = +((o.s || 1) * k).toFixed(3); tidy(); redraw(); },
    ovHide(key, id, on) { const o = ovTweak(key, id); o.hide = !!on; tidy(); redraw(); },
    ovReset(key, id) { const s = tw(key); if (s?.overlays) delete s.overlays[id]; tidy(); redraw(); },
    // ---- cuts: the next (dir 1) or previous (-1) change of shot from the moment on screen, in source time
    findCut(dir, from, f) {
      if (f) fps = f;
      const t0 = from ?? now(), s0 = time(t0), nameAt = (s) => shotAt ? shotAt(s) : (step(s), nameNow());
      const name0 = nameAt(s0);
      let found = null;
      for (let i = 1; i <= fps * 40; i++) {
        const s = s0 + dir * i / fps; if (s < 0) break;
        const n = nameAt(s);
        if (n !== name0) { const at = dir > 0 ? s : s + 1 / fps; found = { at: +at.toFixed(4), from: dir > 0 ? name0 : n, to: dir > 0 ? n : name0 }; break; }
      }
      if (!shotAt) redraw();
      if (!found) return null;
      const c = data.cuts.find((x) => Math.abs(x.at - found.at) < 1e-3);
      return { ...found, d: c ? c.d : 0, film: +(found.at + (c ? c.d : 0)).toFixed(4) };
    },
    cutShift(at, frames, f) {
      if (f) fps = f;
      let c = data.cuts.find((x) => Math.abs(x.at - at) < 1e-3);
      if (!c) data.cuts.push(c = { at, d: 0 });
      c.d = +Math.max(-1.5, Math.min(1.5, c.d + frames / fps)).toFixed(4);
      const d = c.d; tidy(); redraw(); return d;
    },
    cutReset(at) { data.cuts = data.cuts.filter((x) => Math.abs(x.at - at) >= 1e-3); redraw(); },
    cuts: () => data.cuts.map((c) => ({ ...c })),
    // the object under a point of the view (-1..1, y up), with its parents up to the scene for "select the bigger thing"
    pick(nx, ny) {
      const h = hitAt(nx, ny); if (!h) return null;
      const chain = [];
      for (let a = h.object; a && a !== scene; a = a.parent) chain.push(describe(a));
      // default: a whole thing, not one of its faces: a named part, else the biggest group under 25 m (not the whole set)
      let sel = chain.findIndex((c) => c.name);
      if (sel < 0) { sel = 0; for (let i = chain.length - 1; i >= 0; i--) if (Math.max(...chain[i].size) < 25) { sel = i; break; } }
      return { point: h.point.toArray().map((n) => +n.toFixed(3)), chain, sel };
    },
    info(path) { const o = find(path); return o ? describe(o) : null; },
    // ---- objects: drag in the view (along the plane facing the camera through the object, or only up/down)
    drag(key, path, nx0, ny0, nx1, ny1, vertical) {
      const o = find(path); if (!o) return;
      const box = new THREE.Box3().setFromObject(o), c = box.isEmpty() ? o.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
      const n = camera.getWorldDirection(new THREE.Vector3());
      if (vertical) { n.y = 0; if (n.lengthSq() < 1e-6) n.set(0, 0, -1); n.normalize(); }
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, c);
      const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
      ray.setFromCamera({ x: nx0, y: ny0 }, camera); if (!ray.ray.intersectPlane(plane, p0)) return;
      ray.setFromCamera({ x: nx1, y: ny1 }, camera); if (!ray.ray.intersectPlane(plane, p1)) return;
      const w = p1.sub(p0); if (vertical) { w.x = 0; w.z = 0; }
      this.nudge(key, path, w.toArray());
    },
    // move by a world-space step (converted into the object's parent space)
    nudge(key, path, world) {
      const o = find(path); if (!o || !o.parent) return;
      o.parent.updateMatrixWorld(true);
      const a = o.getWorldPosition(new THREE.Vector3()), b = a.clone().add(V.fromArray(world));
      const la = o.parent.worldToLocal(a.clone()), lb = o.parent.worldToLocal(b.clone());
      const d = objTweak(key, path), dp = lb.sub(la);
      d.dp = r3((d.dp ? V.fromArray(d.dp) : V.set(0, 0, 0)).add(dp).toArray());
      tidy(); redraw();
    },
    // put it on what is under it (or lift it out of what it sank into)
    ground(key, path) {
      const o = find(path); if (!o) return null;
      const box = new THREE.Box3().setFromObject(o); if (box.isEmpty()) return null;
      const mine = new Set(); o.traverse((ch) => mine.add(ch));
      const c = box.getCenter(new THREE.Vector3()), h = box.max.y - box.min.y;
      ray.set(V.set(c.x, box.max.y + h * 0.5 + 0.01, c.z), V2.set(0, -1, 0)); ray.near = 0; ray.far = 1e4;
      const hit = ray.intersectObjects(scene.children, true).find((x) => !mine.has(x.object) && x.object.isMesh && x.object.visible && x.point.y <= box.min.y + h * 0.25 && (!x.face || x.face.normal.clone().transformDirection(x.object.matrixWorld).y > 0.3));
      // only a surface close below (a figure floating in space must not drop 60 m to the planet)
      if (!hit || box.min.y - hit.point.y > Math.max(0.5, h * 2)) return null;
      this.nudge(key, path, [0, hit.point.y - box.min.y, 0]);
      return +(hit.point.y - box.min.y).toFixed(3);
    },
    rotate(key, path, deg) { const d = objTweak(key, path); d.ry = +(((d.ry || 0) + deg) % 360).toFixed(2); tidy(); redraw(); },
    scale(key, path, k) { const d = objTweak(key, path); d.s = +((d.s || 1) * k).toFixed(4); tidy(); redraw(); },
    hide(key, path, on) { const d = objTweak(key, path); d.hide = !!on; tidy(); redraw(); },
    resetObj(key, path) { const s = tw(key); if (s?.objects) delete s.objects[path]; tidy(); redraw(); },
    // ---- camera: a free camera the editor steers; save() turns it into the shot's tweak (relative to its own camera)
    freeStart() {
      const c = camera.getWorldDirection(new THREE.Vector3());
      const h = hitAt(0, 0), dist = h ? Math.min(h.distance, 60) : 10;
      free = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov, target: camera.position.clone().addScaledVector(c, dist) };
      redraw(); return this.freeState();
    },
    freeState: () => free && { pos: free.pos.toArray(), fov: free.fov },
    // orbit around what is under the pointer when a drag starts (kept when nothing is there)
    pivotAt(nx, ny) {
      if (!free) return;
      const h = hitAt(nx, ny);
      if (h && h.distance < 500) free.target.copy(h.point);
    },
    freeStop() { free = null; redraw(); },
    // orbit (drag), pan (shift/right drag), dolly (wheel); dx/dy in view units (-1..1 across the frame)
    nav(kind, dx, dy) {
      if (!free) this.freeStart();
      const off = free.pos.clone().sub(free.target), dist = off.length();
      if (kind === 'orbit') {
        // turn the camera and its position around the pivot together (no jump to look at the pivot)
        const right = V.set(1, 0, 0).applyQuaternion(free.quat).normalize();
        const q = new THREE.Quaternion().setFromAxisAngle(V2.set(0, 1, 0), -dx * 1.6)
          .multiply(new THREE.Quaternion().setFromAxisAngle(right, dy * 1.6));
        free.pos.sub(free.target).applyQuaternion(q).add(free.target);
        free.quat.premultiply(q).normalize();
      } else if (kind === 'pan') {
        const k = dist * Math.tan(free.fov * Math.PI / 360);
        const right = V.set(1, 0, 0).applyQuaternion(free.quat).multiplyScalar(-dx * k * (camera.aspect || 1.78));
        const up = V2.set(0, 1, 0).applyQuaternion(free.quat).multiplyScalar(-dy * k);
        free.pos.add(right).add(up); free.target.add(right).add(up);
      } else if (kind === 'look') {     // turn the head in place
        E.setFromQuaternion(free.quat, 'YXZ'); E.y -= dx * 1.2; E.x = Math.min(1.5, Math.max(-1.5, E.x + dy * 1.2)); free.quat.setFromEuler(E);
        free.target.copy(free.pos).add(V.set(0, 0, -dist).applyQuaternion(free.quat));
      } else if (kind === 'dolly') {
        const nd = Math.max(0.05, dist * Math.exp(dx));
        free.pos.copy(free.target).add(off.setLength(nd));
      } else if (kind === 'fov') {
        free.fov = Math.min(110, Math.max(8, dx));
      }
      redraw();
    },
    // the free camera as this shot's camera: stored relative to what the shot itself does at this moment
    saveCam(key) {
      if (!free) return null;
      const iq = orig.quat.clone().invert();
      const dp = free.pos.clone().sub(orig.pos).applyQuaternion(iq), dq = iq.multiply(free.quat).normalize();
      const s = tw(key, true); s.camera = { dp: r3(dp.toArray()), dq: r3(dq.toArray()) };
      if (Math.abs(free.fov - orig.fov) > 0.05) s.camera.fov = +free.fov.toFixed(2);
      free = null; tidy(); redraw(); return s.camera;
    },
    resetCam(key) { const s = tw(key); if (s) delete s.camera; free = null; tidy(); redraw(); },
  };
  // the slot's camera change on another camera of the same shot (e.g. the one a frame earlier, for motion blur)
  function camOn(c) {
    if (lastCam.free) { c.position.copy(lastCam.free.position); c.quaternion.copy(lastCam.free.quaternion); c.fov = lastCam.free.fov; return; }
    const t = lastCam.tw; if (!t) return;
    if (t.dp) c.position.add(V.fromArray(t.dp).applyQuaternion(c.quaternion));
    if (t.dq) c.quaternion.multiply(Q.fromArray(t.dq));
    if (t.fov) c.fov = t.fov;
  }
  return { restore, apply, time, data, camOn };
}
