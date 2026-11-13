import test from 'node:test';
import assert from 'node:assert/strict';
import { motionProfile, platformOffset } from '../platform-motion.mjs';
test('platform motion is stationary through ten seconds and eases in continuously', () => {
  for(let i=0;i<100;i++) {
    const p=motionProfile(i);
    assert.equal(platformOffset(10,p,1,-1,2.5),0);
    assert.ok(Math.abs(platformOffset(10.001,p,1,-1,2.5))<.000001);
  }
});
test('varied motion remains slow and inside baseline vertical limits over long runs', () => {
  const speeds = new Set();
  let enabled = 0;
  for(let i=0;i<100;i++) {
    const p=motionProfile(i); speeds.add(p.speed); enabled+=Number(p.enabled);
    for(const base of [-1,-.9,0,1,2.4,2.5]) {
      let previous=0;
      for(let t=0;t<180;t+=1/60) {
        const offset=platformOffset(t,p,base,-1,2.5);
        assert.ok(Math.abs(offset)<=.24);
        assert.ok(base+offset>=-1 && base+offset<=2.5);
        assert.ok(Math.abs(offset-previous)*60<.32, 'motion exceeds gentle vertical speed');
        previous=offset;
      }
    }
  }
  assert.ok(enabled>35 && enabled<80);
  assert.ok(speeds.size>90);
});
test('profile generation is repeatable and does not consume terrain randomness', () => {
  const original=Math.random;
  Math.random=()=>{throw new Error('terrain RNG consumed');};
  try { assert.deepEqual(motionProfile(42),motionProfile(42)); } finally {Math.random=original;}
});
