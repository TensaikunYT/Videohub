import test from 'node:test';
import assert from 'node:assert/strict';
import {activeRenders,elapsedSeconds,timeText,remainingText} from './render-status.js';
const now=Date.parse('2026-11-03T13:00:00Z');
test('elapsed duration uses job start, not queue entry or movie duration',()=>{
 const row=activeRenders({jobs:[{id:'one',state:'running',createdAt:'2026-11-03T12:00:00Z',startedAt:'2026-11-03T12:57:30Z',dur:7200}]})[0];
 assert.equal(elapsedSeconds(row,now),150);
 assert.equal(timeText(elapsedSeconds(row,now)),'2 min 30 s');
 assert.equal(elapsedSeconds({...row,state:'queued'},now),null);
});
test('native process and queue job with the same PID are one render',()=>{
 const rows=activeRenders({guard:{running:true,renders:[{rootPid:42,start:'2026-11-03T12:57:30Z'}]},jobs:[{id:'one',state:'running',pid:42,startedAt:'2026-11-03T12:57:30Z'}]});
 assert.equal(rows.length,1);assert(rows[0].native&&rows[0].job);
});
test('stale guard entries are not shown as running',()=>{
 assert.equal(activeRenders({guard:{running:false,renders:[{rootPid:42}]}}).length,0);
});
test('ETA counts down from its own progress sample and never promises a false zero',()=>{
 const row={state:'running',progress:.4,etaSec:300,etaAt:now-10000};
 assert.equal(remainingText(row,now),'≈ 4 min 50 s');
 assert.equal(remainingText({...row,etaSec:3},now),'Updating estimate…');
 assert.equal(remainingText({...row,etaAt:now-70000},now),'Updating estimate…');
 assert.equal(remainingText({...row,state:'paused'},now),'Paused');
 assert.equal(remainingText({...row,state:'queued'},now),'Not started yet');
 assert.equal(remainingText({...row,etaSec:null},now),'Calculating…');
});
test('guard snapshot does not refresh an old queue ETA',()=>{
 const row=activeRenders({guard:{running:true,updated:new Date(now).toISOString(),renders:[{rootPid:42,etaSec:null}]},jobs:[{id:'one',state:'running',pid:42,etaSec:100,progressAt:now-70000}]})[0];
 assert.equal(remainingText(row,now),'Updating estimate…');
 assert.equal(timeText(3723),'1 h 02 min 3 s');
});
