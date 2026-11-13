import { districtBlend } from './progression.mjs';
// Fixed decorative population, drawn behind WebGL. No gameplay RNG or colliders.
export function createDistricts() {
  const canvas = document.getElementById('district-canvas');
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0;
  function resize() {
    width = innerWidth; height = innerHeight;
    const dpr = Math.min(devicePixelRatio, 1.5);
    canvas.width = width * dpr; canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', resize); resize();
  function line(x, y, a, b) { ctx.moveTo(x, y); ctx.lineTo(a, b); }
  return function draw(seconds, distance) {
    ctx.clearRect(0, 0, width, height);
    const { weights } = districtBlend(seconds);
    ctx.lineWidth = 1;
    // Rooftop details belong to skyline buildings, never detached screen-space glyphs.
    const storm = weights[1];
    ctx.globalAlpha = storm * .035; ctx.fillStyle = '#76b8ff';
    for (let i = 0; i < 3; i++) {
      const x = width * (.15 + i * .34);
      ctx.beginPath(); ctx.moveTo(x, height * .1); ctx.lineTo(x - 45, height * .68);
      ctx.lineTo(x + 95, height * .68); ctx.closePath(); ctx.fill();
    }

    ctx.globalAlpha = storm * .2; ctx.strokeStyle = '#64cde8'; ctx.beginPath();
    for (let i = 0; i < 100; i++) {
      const x = (i * 97.3 - seconds * 38) % (width + 80);
      const y = (i * 61.7 + seconds * 230) % height;
      line((x + width + 80) % (width + 80), y, (x + width + 80) % (width + 80) - 4, y + 13);
    }
    ctx.stroke();
    ctx.globalAlpha = storm * .28; ctx.strokeStyle = '#bb6afa'; ctx.beginPath();
    for (let j = 0; j < 2; j++) {
      const y = height * (.18 + j * .12);
      line(0, y, width, y - 24);
      for (let i = 0; i < 7; i++) {
        const x = ((i * 190 + seconds * 60) % (width + 200)) - 100;
        line(x, y - x / width * 24 - 5, x + 35, y - x / width * 24 - 5);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = weights[2] * .28; ctx.strokeStyle = '#ad72db';
    for (let i = 0; i < 4; i++) {
      const x = ((i * 390 - distance * 5) % (width + 400) + width + 400) % (width + 400) - 200;
      const y = height * .28; const r = Math.min(75, height * .13);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r + 12, Math.PI, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      for (let blade = 0; blade < 6; blade++) {
        const a = seconds * .4 + blade * Math.PI / 3;
        line(x + Math.cos(a) * 12, y + Math.sin(a) * 12, x + Math.cos(a + .35) * (r - 8), y + Math.sin(a + .35) * (r - 8));
      }
      ctx.moveTo(x - 160, y + 60); ctx.bezierCurveTo(x - 90, y - 110, x + 90, y - 110, x + 160, y + 60);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
}
