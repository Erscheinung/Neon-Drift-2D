import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, tickRun, recordLanding, districtBlend } from '../progression.mjs';
test('inactive time earns nothing and long frame gaps cannot award milestones', () => {
  const run = createRun();
  tickRun(run, 120, false); assert.equal(run.seconds, 0);
  tickRun(run, 120, true); assert.equal(run.seconds, .1); assert.equal(run.next, 0);
});
test('milestones are awarded once in order and retries reset progress', () => {
  const run = createRun(), awards = [];
  for(let i=0;i<1210;i++) { const award = tickRun(run,.1,true); if(award) awards.push(award); }
  assert.deepEqual(awards,[30,60,120]); assert.equal(createRun().seconds,0);
});
test('landing challenge resets on non-flip landing without changing scores', () => {
  const run = createRun();
  for(let i=0;i<3;i++) recordLanding(run,1);
  assert.equal(run.streak,3); assert.match(run.message,/3 FLIP/);
  recordLanding(run,0); assert.equal(run.streak,0); assert.equal(run.bestStreak,3);
});
test('district transitions are continuous, normalized and cyclic', () => {
  for(const t of [0,5,6,6.99,7,13.99,14,20.99,21]) {
    const {weights}=districtBlend(t);
    assert.ok(weights.every(w=>w>=0 && w<=1));
    assert.ok(Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-10);
  }
  assert.deepEqual(districtBlend(6).weights,[.5,.5,0]);
  assert.deepEqual(districtBlend(21).weights,[1,0,0]);
});

test('districts arrive at seven and fourteen active seconds', () => {
  assert.equal(districtBlend(7).phase, 1);
  assert.equal(districtBlend(14).phase, 2);
});
