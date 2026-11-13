export const DISTRICTS = ['PRECISION SKYLINE', 'STORMLINE TRANSIT', 'REACTOR CANOPY'];
export const MILESTONES = [30, 60, 120];
export function createRun() { return { seconds: 0, streak: 0, bestStreak: 0, next: 0, message: '', messageTime: 0 }; }
export function tickRun(run, delta, active) {
  if (!active || !Number.isFinite(delta) || delta <= 0) return null;
  run.seconds += Math.min(delta, 0.1);
  run.messageTime = Math.max(0, run.messageTime - delta);
  if (run.next < MILESTONES.length && run.seconds >= MILESTONES[run.next]) {
    const reached = MILESTONES[run.next++];
    run.message = `${reached}s RUN • ${['SKYLINE RIDER', 'STORM RIDER', 'REACTOR RIDER'][run.next - 1]}`;
    run.messageTime = 4;
    return reached;
  }
  return null;
}
export function recordLanding(run, flips) {
  run.streak = flips > 0 ? run.streak + 1 : 0;
  run.bestStreak = Math.max(run.bestStreak, run.streak);
  if (run.streak > 0 && run.streak % 3 === 0 && run.messageTime === 0) {
    run.message = `${run.streak} FLIP LANDINGS IN A ROW`;
    run.messageTime = 3;
  }
}
export function districtBlend(seconds) {
  const phase = Math.floor(seconds / 30) % 3;
  const blend = Math.max(0, (seconds % 30 - 24) / 6);
  const weights = [0, 0, 0];
  weights[phase] = 1 - blend;
  weights[(phase + 1) % 3] = blend;
  return { phase, weights };
}
