import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const audioSource = readFileSync(new URL('../audio.js', import.meta.url), 'utf8')
  .replace('import.meta.url', JSON.stringify(new URL('../audio.js', import.meta.url).href))
  .replace('export default audio;', 'globalThis.audio = audio;');

test('music preloads once, loops, pauses, resumes and respects mute', () => {
  const players = [];
  const context = { URL, Audio: class {
    constructor() { this.paused = true; this.plays = 0; players.push(this); }
    play() { this.paused = false; this.plays++; return Promise.resolve(); }
    pause() { this.paused = true; }
  } };
  vm.runInNewContext(audioSource, context);
  const { audio } = context;
  assert.equal(players.length, 1);
  assert.equal(players[0].preload, 'auto');
  assert.equal(players[0].loop, true);
  assert.equal(players[0].plays, 0);
  audio.playMusic();
  audio.playMusic();
  assert.equal(players[0].plays, 1);
  audio.pauseMusic();
  assert.equal(players[0].paused, true);
  audio.playMusic();
  assert.equal(players[0].plays, 2);
  assert.equal(players.length, 1);
  audio.setMuted(true);
  assert.equal(players[0].muted, true);
});

test('unavailable or blocked audio cannot throw into game controls', async () => {
  for (const mode of ['constructor', 'play', 'promise']) {
    const context = { URL, window: { AudioContext: class {
      constructor() { throw new Error('unavailable'); }
    } }, Audio: class {
      constructor() { if (mode === 'constructor') throw new Error('unavailable'); this.paused = true; }
      play() { if (mode === 'play') throw new Error('blocked'); return Promise.reject(new Error('blocked')); }
      pause() {}
    } };
    vm.runInNewContext(audioSource, context);
    assert.doesNotThrow(() => { context.audio.unlock(); context.audio.playMusic(); context.audio.pauseMusic(); });
    await new Promise(resolve => setImmediate(resolve));
  }
});

const game = readFileSync(new URL('../game.js', import.meta.url), 'utf8');
function inputHarness() {
  const handlers = {};
  const canvasHandlers = {};
  const context = {
    window: { PointerEvent: true, addEventListener: (name, fn) => { handlers[name] = fn; } },
    canvas: { addEventListener: (name, fn) => { canvasHandlers[name] = fn; } },
    starts: 0,
  };
  vm.runInNewContext(`let gamePhase = 'IDLE', deathLockout = 0;
    function startGame() { starts++; gamePhase = 'PLAYING'; consumeInput(); }
    ${game.slice(game.indexOf('const input = {'), game.indexOf('function updatePhysics(delta)'))}
    globalThis.controls = { input, pressGameControl };
  `, context);
  return { context, handlers, canvasHandlers, ...context.controls };
}

test('Space starts synchronously and repeated keydown does not retrigger boost', () => {
  const { context, handlers, input } = inputHarness();
  handlers.keydown({ code: 'Space', repeat: false, preventDefault() {} });
  assert.equal(context.starts, 1);
  assert.equal(input.held, true);
  handlers.keydown({ code: 'Space', repeat: true, preventDefault() {} });
  assert.equal(input.justPressed, false);
  handlers.keyup({ code: 'Space' });
  assert.equal(input.held, false);
});

test('overlay press does not capture a pointer; outside release and blur clear held input', () => {
  const { context, handlers, input, pressGameControl, canvasHandlers } = inputHarness();
  pressGameControl({ pointerId: 1, currentTarget: { setPointerCapture() { assert.fail('hidden overlay captured pointer'); } }, preventDefault() {} });
  assert.equal(context.starts, 1);
  handlers.pointerup();
  assert.equal(input.held, false);
  input.held = true;
  canvasHandlers.lostpointercapture();
  assert.equal(input.held, false);
  input.held = true;
  input.justPressed = true;
  handlers.blur();
  assert.equal(input.held, false);
  assert.equal(input.justPressed, false);
});

test('pooled platforms retain collision-aligned bounds and fixed end caps across reuse', () => {
  const context = {};
  vm.runInNewContext(game.slice(game.indexOf('function resizePlatform('), game.indexOf('function buildShard()')), context);
  const deck = { userData: {}, scale: { x: 1 } };
  const caps = [-1, 1].map(endSign => ({ userData: { endSign }, position: { x: 0 }, scale: { x: 1 } }));
  const group = { children: [deck, ...caps] };
  for (const width of [12, 2.4, 8, 3.4, 5, 2.4]) {
    context.resizePlatform(group, width);
    assert.ok(Math.abs(5 * deck.scale.x - width) < 1e-10);
    assert.equal(caps[0].position.x, -width / 2);
    assert.equal(caps[1].position.x, width / 2);
    assert.equal(caps[0].scale.x, 1);
    assert.equal(group.children[0], deck);
  }
});
