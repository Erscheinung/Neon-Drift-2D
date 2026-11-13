import { districtBlend } from './progression.mjs';

// Three cached panoramic paintings. Only compositing and a small set of accents
// run during play; no per-frame gradients, geometry construction or shadows.
export function createDistricts() {
  const canvas = document.getElementById('district-canvas');
  const ctx = canvas.getContext('2d');
  let width, height, paintings = [], lastDraw = -Infinity;
  const mod = (x, n) => ((x % n) + n) % n;
  function painting(kind) {
    const layer = document.createElement('canvas');
    layer.width = width; layer.height = height;
    const c = layer.getContext('2d');
    const w = width, h = height, horizon = h * .76;
    const colors = [['#09051e','#251048','#4a1764'], ['#030c20','#102840','#18415b'], ['#100722','#261133','#5b214b']][kind];
    const sky = c.createLinearGradient(0,0,0,h);
    colors.forEach((v,i)=>sky.addColorStop(i/2,v)); c.fillStyle=sky; c.fillRect(0,0,w,h);
    const glow = c.createRadialGradient(w*.62,h*.35,0,w*.62,h*.35,w*.48);
    glow.addColorStop(0,kind===1?'#297e8844':'#cb48cb33'); glow.addColorStop(1,'#00000000');
    c.fillStyle=glow;c.fillRect(0,0,w,h);
    const line = (x,y,a,b) => { c.moveTo(x,y);c.lineTo(a,b); };
    // City depth: tall silhouettes, sparse window strips and clear rooftop seams.
    for(let depth=0;depth<3;depth++) {
      const step=w/(13-depth*3), base=horizon+depth*18;
      for(let i=0;i<15;i++) {
        const x=i*step-step*.5, bh=h*(.13+((i*7+depth*11)%17)/60), bw=step*.68;
        c.fillStyle=['#151328','#100f24','#090c1b'][depth];c.fillRect(x,base-bh,bw,bh);
        c.strokeStyle=kind===1?'#2b687a':'#643372';c.globalAlpha=.45;c.beginPath();line(x,base-bh,x+bw,base-bh);c.stroke();
        c.fillStyle=kind===1?'#4aa4b0':'#9c63bd';c.globalAlpha=.23;
        for(let row=0;row<9;row++) for(let col=0;col<3;col++) if((row+col+i)%3) c.fillRect(x+8+col*bw*.25,base-bh+12+row*bh/11,2,4);
        c.globalAlpha=1;
      }
    }
    if(kind===0) {
      // Precision: monumental needle towers joined by orbital skybridges.
      c.strokeStyle='#7897c2';c.globalAlpha=.35;c.lineWidth=1;
      c.beginPath();c.ellipse(w*.55,h*.27,w*.34,h*.11,-.16,0,Math.PI*2);c.stroke();
      c.beginPath();c.ellipse(w*.55,h*.27,w*.34-8,h*.11-5,-.16,0,Math.PI*2);c.stroke();c.globalAlpha=1;
      for(let i=0;i<5;i++) {
        const x=w*(.1+i*.2), top=h*(.12+(i%3)*.055), bw=Math.max(18,w*.035);
        c.fillStyle='#101125';c.beginPath();c.moveTo(x-bw,horizon);c.lineTo(x-bw*.55,top+65);c.lineTo(x,top);c.lineTo(x+bw*.55,top+65);c.lineTo(x+bw,horizon);c.fill();
        c.strokeStyle='#3a899c';c.globalAlpha=.5;c.stroke();c.beginPath();line(x,top,x,horizon);c.stroke();
        c.strokeStyle='#8055ad';c.beginPath();for(let y=top+90;y<horizon;y+=22) line(x-bw*.6,y,x+bw*.6,y);c.stroke();c.globalAlpha=1;
      }
    } else if(kind===1) {
      // Stormline: immense suspended rail viaducts, cable fans and distant traffic.
      for(let tier=0;tier<2;tier++) {
        const y=h*(.3+tier*.18);
        c.fillStyle='#0a1727';c.fillRect(0,y,w,12);
        c.strokeStyle=tier?'#63518c':'#387786';c.lineWidth=2;c.beginPath();line(0,y,w,y);c.stroke();
        for(let i=0;i<3;i++) {
          const x=w*(.12+i*.38), top=y-h*.16;
          c.fillStyle='#122139';c.fillRect(x-7,top,14,horizon-top);
          c.strokeStyle='#355064';c.lineWidth=1;c.beginPath();
          for(let j=-4;j<=4;j++) line(x,top,x+j*w*.035,y);c.stroke();
        }
      }
      c.globalAlpha=.12;c.fillStyle='#78c9db';
      for(let i=0;i<4;i++) {const x=w*(i*.3);c.beginPath();c.moveTo(x,0);c.lineTo(x+w*.06,h*.65);c.lineTo(x+w*.17,h*.65);c.closePath();c.fill();}c.globalAlpha=1;
    } else {
      // Reactor: a cavernous industrial aperture, thick arches and conduits.
      const x=w*.57,y=h*.36,r=Math.min(w*.27,h*.36);
      c.fillStyle='#080d1b';c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();
      for(let j=0;j<5;j++) {c.strokeStyle=j%2?'#6c397b':'#284a67';c.lineWidth=j===0?14:2;c.beginPath();c.arc(x,y,r-j*12,0,Math.PI*2);c.stroke();}
      c.lineWidth=2;c.strokeStyle='#443158';c.beginPath();
      for(let i=0;i<24;i++){const a=i*Math.PI/12;line(x+Math.cos(a)*(r-48),y+Math.sin(a)*(r-48),x+Math.cos(a)*r,y+Math.sin(a)*r);}c.stroke();
      for(let i=0;i<3;i++) {const px=w*(i*.5);c.strokeStyle='#100e20';c.lineWidth=28;c.beginPath();c.moveTo(px-w*.3,horizon);c.bezierCurveTo(px-w*.3,-h*.15,px+w*.3,-h*.15,px+w*.3,horizon);c.stroke();c.strokeStyle='#51315c';c.lineWidth=2;c.stroke();}
      for(let i=0;i<3;i++){c.strokeStyle=['#34223e','#224855','#493057'][i];c.lineWidth=7;c.beginPath();c.moveTo(0,h*(.1+i*.04));c.bezierCurveTo(w*.3,h*.4,w*.7,-h*.1,w,h*(.15+i*.04));c.stroke();}
    }
    // Water reflection is cached with the architecture, not redrawn building by building.
    c.save();c.globalAlpha=.24;c.translate(0,horizon*2);c.scale(1,-1);c.drawImage(layer,0,0);c.restore();
    c.fillStyle='#040c1a66';c.fillRect(0,horizon,w,h-horizon);
    c.strokeStyle='#55749b';c.globalAlpha=.15;c.lineWidth=1;c.beginPath();for(let y=horizon+5;y<h;y+=9) line(0,y,w,y);c.stroke();
    // Keep spectacle below the luminance of the playable cyan rails.
    c.globalAlpha=1;c.fillStyle='#04061133';c.fillRect(0,0,w,h);
    return layer;
  }
  function resize() {
    // Cap backing area on large/retina displays; CSS scales cached scenery.
    const scale=Math.min(1,1600/innerWidth,1000/innerHeight);
    width=Math.round(innerWidth*scale);height=Math.round(innerHeight*scale);
    canvas.width=width;canvas.height=height;
    paintings=[0,1,2].map(painting);lastDraw=-Infinity;
  }
  addEventListener('resize',resize);resize();
  return function draw(seconds,distance) {
    const now=performance.now();if(now-lastDraw<1000/30)return;lastDraw=now;
    const {weights}=districtBlend(seconds);
    ctx.clearRect(0,0,width,height);
    // Additive weighted compositing avoids darkening halfway through a dissolve.
    ctx.globalCompositeOperation='lighter';
    for(let i=0;i<3;i++) if(weights[i]>0) {
      ctx.globalAlpha=weights[i];
      const x=-mod(distance*(i===1?1.4:.7),width);
      ctx.drawImage(paintings[i],x,0);ctx.drawImage(paintings[i],x+width,0);
    }
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
    if(weights[1]>0) {
      ctx.strokeStyle='#7ac8df';ctx.globalAlpha=weights[1]*.18;ctx.lineWidth=1;ctx.beginPath();
      for(let i=0;i<65;i++){const x=mod(i*97.3-seconds*38,width),y=mod(i*61.7+seconds*230,height);ctx.moveTo(x,y);ctx.lineTo(x-4,y+12);}ctx.stroke();
      ctx.strokeStyle='#a4b5e0';ctx.globalAlpha=weights[1]*.6;ctx.lineWidth=2;ctx.beginPath();
      for(let tier=0;tier<2;tier++)for(let i=0;i<5;i++){const x=mod(i*241+seconds*(tier?-65:80)-distance*1.4,width);ctx.moveTo(x,height*(.3+tier*.18)-4);ctx.lineTo(x+18,height*(.3+tier*.18)-4);}ctx.stroke();
    }
    if(weights[2]>0) {
      const x=mod(width*.57-distance*.7,width),y=height*.36,r=Math.min(width*.27,height*.36)-55;
      ctx.strokeStyle='#7b4d92';ctx.globalAlpha=weights[2]*.4;ctx.lineWidth=3;ctx.beginPath();
      for(let wrap=-1;wrap<=1;wrap++)for(let i=0;i<8;i++){const a=seconds*.16+i*Math.PI/4;ctx.moveTo(x+wrap*width+Math.cos(a)*r*.2,y+Math.sin(a)*r*.2);ctx.lineTo(x+wrap*width+Math.cos(a+.28)*r,y+Math.sin(a+.28)*r);}ctx.stroke();
    }
    ctx.globalAlpha=1;
  };
}
