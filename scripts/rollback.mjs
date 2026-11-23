#!/usr/bin/env node
// SHA-256 snapshot / verified restore CLI for any VideoHub film project.
//
//   node scripts/rollback.mjs list    "<project>"
//   node scripts/rollback.mjs snapshot "<project>" --kind before --note 11 --prompt "the note text"
//   node scripts/rollback.mjs last    "<project>" --note 11
//   node scripts/rollback.mjs restore "<project>" <snapshot-id>
//
// The VideoHub Reasonix provider calls the same engine automatically before and after every agent
// run. This CLI is for agents that edit files outside a VideoHub run, and for manual recovery.
import fs from 'node:fs';
import path from 'node:path';
import { snapshot, list, restore, lastForNote, status } from '../server/rollback.js';

const argv = process.argv.slice(2);
const cmd = argv[0], dir = argv[1];
if (!cmd || !dir) {
  console.log('usage: rollback.mjs list|snapshot|last|status|restore "<project>" [snapshot-id] [--kind before] [--note 8] [--prompt "text"] [--label "text"]');
  process.exit(2);
}
const opt = name => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const p = { path: path.resolve(dir) };
if (!fs.existsSync(p.path)) { console.error('project not found: ' + p.path); process.exit(2); }
const note = Number(opt('--note') || 0) || 0;
try {
  if (cmd === 'list') {
    console.log(JSON.stringify(list(p), null, 2));
  } else if (cmd === 'snapshot') {
    const m = snapshot(p, { kind: opt('--kind') || 'manual', noteIds: note ? [note] : [], prompt: opt('--prompt') || '', label: opt('--label') || '' });
    console.log(JSON.stringify({ id: m.id, kind: m.kind, sha256: m.sha256, fileCount: m.fileCount, bytes: m.bytes, createdAt: m.createdAt }, null, 2));
  } else if (cmd === 'last' || cmd === 'status') {
    const s = note ? status(p, note) : { available: false, reason: 'pass --note <id>' };
    console.log(JSON.stringify(s, null, 2));
  } else if (cmd === 'restore') {
    const id = argv[2];
    if (!id) throw new Error('snapshot id required');
    console.log(JSON.stringify(restore(p, id), null, 2));
  } else {
    console.error('unknown command: ' + cmd); process.exit(2);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
