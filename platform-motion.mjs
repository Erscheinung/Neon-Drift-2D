// Separate deterministic variation stream: never consumes terrain RNG.
export function motionProfile(index) {
  const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  return { amplitude: .12 + hash(index) * .12, speed: .45 + hash(index + 19) * .35, phase: hash(index + 47) * Math.PI * 2, enabled: hash(index + 83) < .6 };
}
export function platformOffset(seconds, profile, baseY, minY, maxY) {
  if (seconds <= 10 || !profile.enabled) return 0;
  const ramp = Math.min(1, (seconds - 10) / 3);
  const amplitude = Math.min(profile.amplitude, Math.max(0, baseY - minY), Math.max(0, maxY - baseY));
  return Math.sin((seconds - 10) * profile.speed + profile.phase) * amplitude * ramp * ramp * (3 - 2 * ramp);
}
