// The Mac agent's rules, without running it (a live check with dummy renders: docs/MACOS.md, "Checking the agent")
import test from 'node:test';
import assert from 'node:assert/strict';
import { isRender, isRenderScript, isHub, findRoots, parseLog, parseSettings, shares, dutyFor, shortCmd, dur, localTime, DEFAULTS } from './agent-mac.mjs';

const P = (pid, ppid, cmd, name, start = 1000) => ({ pid, ppid, cmd, name, start, ramMB: 10, cpuSec: 0 });

test('what counts as a render: ffmpeg, headless Chromium, render scripts; not VideoHub, tests or the user\'s browser', () => {
  assert.equal(isRender(P(1, 0, '/opt/homebrew/bin/ffmpeg -i x', 'ffmpeg')), true);
  assert.equal(isRender(P(1, 0, 'ffprobe -v error x', 'ffprobe')), false);
  assert.equal(isRender(P(1, 0, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new', 'Google Chrome')), true);
  assert.equal(isRender(P(1, 0, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --type=renderer --user-data-dir=/var/folders/ab/T/puppeteer_dev_profile-x', 'Google Chrome Helper (Renderer)')), true);
  assert.equal(isRender(P(1, 0, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'Google Chrome')), false);   // the user's own Chrome
  assert.equal(isRender(P(1, 0, '/Users/x/.cache/puppeteer/chrome-headless-shell/mac_arm-1/chrome-headless-shell --remote-debugging-pipe', 'chrome-headless-shell')), true);
  assert.equal(isRender(P(1, 0, 'node render.js 2', 'node')), true);
  assert.equal(isRender(P(1, 0, 'node /Users/x/My Films/hello/render.js 2', 'node')), true);   // a folder with a space
  assert.equal(isRender(P(1, 0, 'python3 make_frames.py', 'python3')), true);
  assert.equal(isRender(P(1, 0, 'node /Users/x/VideoHub/server/hub.js', 'node')), false);
  assert.equal(isHub(P(1, 0, 'node /Users/x/VideoHub/guard/agent-mac.mjs --agent', 'node')), true);
  assert.equal(isRenderScript('node --test render.test.js'), false); assert.equal(isRenderScript('node -e "render()"'), false);
  assert.equal(isRenderScript('node tests/render.js'), false); assert.equal(isRenderScript('node --import tsx render.mjs'), true);
  assert.equal(isRenderScript('node make.mjs film --chunks'), true); assert.equal(isRenderScript('node make.mjs film'), false);
  assert.equal(isRenderScript('node server.js'), false);
});

test('render roots: each render tree counted once, under its top-most render process', () => {
  const rows = [P(10, 1, '-zsh', 'zsh', 100), P(11, 10, 'node render.js 2', 'node', 200), P(12, 11, 'Google Chrome --headless=new', 'Google Chrome', 300),
    P(13, 12, 'Google Chrome Helper --type=gpu-process --headless', 'Google Chrome Helper', 400), P(14, 11, 'ffmpeg -i -', 'ffmpeg', 500), P(20, 1, 'ffmpeg -i b', 'ffmpeg', 600),
    P(30, 1, 'node other.js TAGX', 'node', 700)];
  assert.deepEqual(findRoots(rows).sort((a, b) => a - b), [11, 20]);
  assert.deepEqual(findRoots(rows, 'TAGX'), [30]);   // test copies (--only) see only their tagged dummies
});

test('progress from the log: chunk lines, worker lines, percentages, the finished line', () => {
  let j = parseLog('5/5 chunks to render\nchunk 0 ok, 1 done, 4 queued, 10s\nchunk 1 ok, 2 done, 3 queued, 20s\n', {});
  assert.equal(j.progress, 0.4); assert.equal(j.etaSec, 30); assert.equal(j.finished, undefined);
  j = parseLog('[w0] 30/60 frames, 15s\n[w1] 60/60 frames, 20s\nw1 done\n', {}); assert.equal(j.progress, 0.75); assert.equal(j.etaSec, 15);
  j = parseLog('encoding 42.5% done\n', {}); assert.equal(j.progress, 0.425);
  j = parseLog('2/2 chunks to render\nchunk 0 ok, 1 done, 1 queued, 5s\nchunk 1 ok, 2 done, 0 queued, 10s\ndone\n', {}); assert.equal(j.progress, 1); assert.equal(j.finished, true); assert.equal(j.lastLine, 'done');
});

test('CPU shares: calm renders keep what they use, hungry ones split the rest; duty = share / use', () => {
  let s = shares(new Map([[1, 10], [2, 80], [3, 80]]), 50);   // 50 % of the Mac for three renders
  assert.equal(s.get(1), 50 / 3); assert.equal(s.get(2), 20); assert.equal(s.get(3), 20);
  s = shares(new Map([[1, 100]]), 90); assert.equal(s.get(1), 90);
  assert.equal(dutyFor(20, 80), 0.25); assert.equal(dutyFor(50, 10), 1); assert.equal(dutyFor(5, 0.3), 1); assert.equal(dutyFor(0.1, 100), 0.02);   // never below 2 %
});

test('settings: defaults (low priority off on a Mac), bounds kept, junk ignored; small helpers', () => {
  assert.deepEqual(parseSettings(''), DEFAULTS); assert.equal(DEFAULTS.LowPrio, 0);
  const s = parseSettings('﻿CapActive=55\r\nCapIdle=0\r\nIdleMin=abc\r\nLowPrio=1\nPauseMB=1200\nNope=1');
  assert.equal(s.CapActive, 55); assert.equal(s.CapIdle, DEFAULTS.CapIdle); assert.equal(s.IdleMin, DEFAULTS.IdleMin); assert.equal(s.LowPrio, 1); assert.equal(s.PauseMB, 1200);
  assert.equal(shortCmd('/opt/homebrew/Cellar/node/26.7.0/bin/node /Users/x/films/hello/render.js 2', 'node'), 'node render.js 2');
  assert.equal(shortCmd('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new', 'Google Chrome'), 'Google Chrome --headless=new');
  assert.equal(dur(75), '1 min 15 s'); assert.equal(dur(3725), '1 h 2 min'); assert.equal(dur(9), '9 s');
});

test('state.json times are local and zone-less, as the Windows agent writes them (the hub reads them as local time)', () => {
  const t = Date.now(), s = localTime(t);
  assert.match(s, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
  assert.ok(Math.abs(new Date(s).getTime() - t) < 1000);
  assert.match(localTime(t, ' '), /^\d{4}-\d\d-\d\d \d\d:/);
});
