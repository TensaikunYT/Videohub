import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWindowsSecurity } from './windows-security.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp', 'security-metadata');
test('local source diagnostics distinguish old launchers and changed source without exposing paths or file contents', () => {
  const dir = fs.mkdtempSync((fs.mkdirSync(root, { recursive: true }), path.join(root, 'copy-')));
  const source = path.join(dir, 'open.cmd');
  fs.writeFileSync(source, '@node scripts/install.mjs open\n');
  const first = inspectWindowsSecurity(dir);
  assert.deepEqual(first.legacyFiles, []);
  assert.equal(first.sourceFingerprint, inspectWindowsSecurity(dir).sourceFingerprint);
  fs.writeFileSync(source, '@node scripts/install.mjs open --server\n');
  assert.notEqual(first.sourceFingerprint, inspectWindowsSecurity(dir).sourceFingerprint);
  fs.mkdirSync(path.join(dir, 'guard'));
  fs.writeFileSync(path.join(dir, 'guard', 'VideoHubAgent.exe'), 'test fixture, never executed');
  fs.writeFileSync(path.join(dir, 'open.vbs'), 'test fixture, never executed');
  const report = inspectWindowsSecurity(dir), serialized = JSON.stringify(report);
  assert.deepEqual(report.legacyFiles.sort(), ['guard/VideoHubAgent.exe', 'open.vbs']);
  assert.equal(serialized.includes(dir), false);
  assert.equal(serialized.includes('test fixture'), false);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['guard', 'open.cmd', 'open.vbs']);
});

test('local source diagnostics report policy overrides without executing scripts', () => {
  const dir = fs.mkdtempSync((fs.mkdirSync(root, { recursive: true }), path.join(root, 'policy-')));
  fs.writeFileSync(path.join(dir, 'SETUP.cmd'), 'powershell -ExecutionPolicy Bypass -File setup.ps1\n');
  const report = inspectWindowsSecurity(dir);
  assert.equal(report.files.find(f => f.file === 'SETUP.cmd').policyOverride, true);
  assert.equal(report.files.find(f => f.file === 'open.cmd').status, 'missing');
});

test('source diagnostics refuse linked source folders outside the inspected installation', () => {
  const dir = fs.mkdtempSync((fs.mkdirSync(root, { recursive: true }), path.join(root, 'linked-')));
  const outside = fs.mkdtempSync(path.join(root, 'outside-'));
  fs.writeFileSync(path.join(outside, 'install.mjs'), 'private fixture');
  fs.mkdirSync(path.join(dir, 'scripts'));
  const source = path.join(dir, 'scripts', 'install.mjs');
  fs.writeFileSync(source, 'private fixture');
  const filesystem = { ...fs, realpathSync: full => full === source ? path.join(outside, 'install.mjs') : fs.realpathSync(full), readFileSync: full => { assert.notEqual(full, source, 'outside files must never be read'); return fs.readFileSync(full); } };
  const file = inspectWindowsSecurity(dir, { filesystem }).files.find(f => f.file === 'scripts/install.mjs');
  assert.equal(file.status, 'outside-install');
  assert.equal(file.sha256, undefined);
});
