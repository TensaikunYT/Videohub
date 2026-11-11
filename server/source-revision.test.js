import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import test from 'node:test';
import path from 'node:path';
import { sourceRevision, invalidateSource } from './source-revision.js';
test('nested sources, deletions and shared studio engines change the live revision', () => {
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'videohub-source-test-'));
try {
const base=path.join(temp,'source');
fs.mkdirSync(path.join(base,'src','nested'),{recursive:true});
const p={path:base,id:'source-test'};
const file=path.join(base,'src','nested','scene.js');
fs.writeFileSync(file,'v1');
const first=sourceRevision(p).revision;
fs.writeFileSync(file,'version2');invalidateSource(p);
assert.notEqual(sourceRevision(p).revision,first); console.log('PASS nested source changes invalidate live revision');
const second=sourceRevision(p).revision;fs.unlinkSync(file);invalidateSource(p);
assert.notEqual(sourceRevision(p).revision,second);console.log('PASS deleted source changes revision');
const third=sourceRevision(p).revision;fs.writeFileSync(path.join(base,'tweaks.json'),'{"items2d":[]}');invalidateSource(p);
assert.equal(sourceRevision(p).revision,third);console.log('PASS live tweaks do not change the code revision');
const engine=path.join(temp,'studio','engine');fs.mkdirSync(engine,{recursive:true});
const studio={...p,id:'studio-test',studio:path.dirname(engine)};
fs.writeFileSync(path.join(engine,'runtime.js'),'v1');const a=sourceRevision(studio).revision;
fs.writeFileSync(path.join(engine,'runtime.js'),'v2-changed');invalidateSource(studio);
assert.notEqual(sourceRevision(studio).revision,a);console.log('PASS studio engine changes invalidate scene thumbnails');

} finally { if(path.dirname(temp)!==path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('videohub-source-test-')) throw new Error('Unexpected test directory'); fs.rmSync(temp,{recursive:true}); }
});
