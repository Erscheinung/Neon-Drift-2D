import { initSkyline } from './skyline.js';
// The original skyline renderer owns all districts and the only backdrop loop.
export function createDistricts() {
  let seconds = 0;
  initSkyline(() => seconds);
  return value => { seconds = value; };
}
