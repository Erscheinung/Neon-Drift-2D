import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {districtBlend} from '../progression.mjs';
test('procedural districts render and crossfade without growing building caches', () => {
  let seconds=0, scheduled, canvases=0, draws=0;
  const gradient={addColorStop(){}};
  function canvas() {
    canvases++;
    const context=new Proxy({}, {get(target,key) {
      if(key in target) return target[key];
      return (...args)=>{
        for(const arg of args) if(typeof arg==='number') assert.ok(Number.isFinite(arg), `${String(key)} has invalid coordinate`);
        if(key==='drawImage') {assert.ok(args[0]);draws++;}
        if(String(key).includes('Gradient')) return gradient;
      };
    }});
    return {style:{},getContext:()=>context};
  }
  const output=canvas();
  const sandbox={Math, districtBlend, performance:{now:()=>0},
    window:{innerWidth:800,innerHeight:600,devicePixelRatio:1,addEventListener(){}},
    document:{hidden:false,getElementById:()=>output,createElement:canvas},
    requestAnimationFrame:fn=>{scheduled=fn;},
    createAmbientState:()=>({}), updateCrows(){},drawCrows(){},updateWind(){},drawWind(){},getSeconds:()=>seconds};
  const source=readFileSync(new URL('../skyline.js',import.meta.url),'utf8')
    .replace(/import[\s\S]*?from '\.\/progression.mjs';/,'')
    .replace(/import[\s\S]*?from '\.\/ambient.js';/,'')
    .replace('export function initSkyline','function initSkyline');
  vm.runInNewContext(source+'\ninitSkyline(getSeconds);',sandbox);
  const initialCanvases=canvases;
  for(let frame=1;frame<100;frame++) {seconds=frame*.25;scheduled(frame*40);}
  assert.equal(canvases,initialCanvases,'transitions must reuse prepared sprites');
  assert.ok(draws>100);
});
