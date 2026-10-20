import type { HumanoidPart } from './HumanoidRig';
import type { ArtBrush } from './ArtBrush';

/** Crossed collar, loose cloth, forearm wraps and a sheathed decorative blade. */
export function paintRonin(part: HumanoidPart, b: ArtBrush): void {
  const { shape, line, ellipse, box, gradient, cloth, light, dark, fabric, skin, skinDark, gold } = b;
  switch (part) {
    case 'coatBack':
      shape('M-16 15-20 13-6-28-2-26Z', gradient('#8d7462', '#534449', '#302e3d'));
      line('M-18 10-7-22', '#b29370', 0.7);
      shape('M-8-29-4-27 1-38-3-40Z', '#44373d');
      for (let y = 0; y < 4; y++) line(`M${-6 + y}-${30 + y * 2} ${-3 + y}-${28 + y * 2}`, '#ccae80', 0.8);
      shape('M-10-28-1-24 0-27-9-31Z', gold);
      break;
    case 'torso':
      shape('M-8-24 Q0-27 8-23 L12-17 9 3-9 3-12-17Z', fabric);
      shape('M-4-25 4-25 4-20-3-20Z', skinDark);
      shape('M-9-23-5-25 7-7 4-3Z', '#d7d5c8');
      shape('M6-24 10-21-3-4-7-6Z', dark);
      line('M7-22-4-6 M-7-20 1-9', light, 0.8);
      shape('M-10-3 10-3 9 3-10 3Z', '#514450');
      line('M-9-1 8-1 M-8 1 8 1', '#c6a883', 0.7);
      box(-0.8, -2.5, 4, 4, '#9c7c64');
      line('M-8-13-6-7 M8-12 6-7', light, 0.55);
      break;
    case 'coatFront':
      shape('M-15 1-3-1 3 2 5 8-4 10-10 7Z', fabric);
      line('M-13 3-7 6-5 9 M-3 3 1 7', light);
      shape('M-6 0-3-1-2 1-4 3Z', '#d1b08b');
      shape('M-5 2-3 2-2 12-5 10Z', '#80634d');
      break;
    case 'scarfTail':
      shape('M3 0-6-1-10 4-5 3-4 6 3 2Z', '#b7a384');
      line('M-4 1-7 3', '#e1c9a1');
      break;
    case 'thigh': case 'thighBack':
      shape('M-4-1 Q0-4 4-1 L5 12 2 16-4 15-5 7Z', part === 'thighBack' ? dark : fabric);
      line('M-1 1-2 11 M2 3 2 12', light, 0.55);
      break;
    case 'shin': case 'shinBack':
      shape('M-3 0 Q0-2 3 0 L2 14-2.5 15-3.5 5Z', dark);
      shape('M-3 6 3 6 2.5 14-2.5 15Z', '#acaa9b');
      for (const y of [7.5, 10, 12.5]) line(`M-2.5 ${y} 2.5 ${y + 0.6}`, '#6a7072', 0.6);
      break;
    case 'boot': case 'bootBack':
      shape('M-3-5 2.5-5 3 0 6 2 6 4.5-4 4.5-4 1Z', '#48454a');
      shape('M-4 3.5 6 3.5 6 5-4 5Z', '#272e36', false);
      line('M-2-3 1.5-3 M0 0 3 2', '#b7a58a', 0.65);
      break;
    case 'upper': case 'upperBack':
      shape('M-4 0 Q0-4 4 0 L5.5 10 3.5 17-4 17-5 11Z', part === 'upperBack' ? gradient(light, dark, '#323243') : fabric);
      line('M-2 2-2 12 M3 5 3 12', light, 0.55);
      shape('M-4 13 4 13 3.5 17-4 17Z', dark);
      break;
    case 'fore': case 'foreBack':
      shape('M-2.6 0 Q0-2 2.6 0 L2 15.5-2 15.5Z', skin);
      shape('M-2.5 5 2.4 5 2 14-2 14Z', '#bcb8a4');
      for (const y of [6.5, 9, 11.5]) line(`M-2 ${y} 2 ${y + 0.7}`, '#716e6b', 0.55);
      break;
    case 'hand': case 'handBack':
      shape('M-2-1.5 Q1-2.5 2.5-0.5 L3 2 1 3-2 2Z', skin);
      line('M0 0.8 2 0.8', skinDark, 0.5);
      break;
    default: break;
  }
  // Keep the visible weave sparse enough to survive the 1x game view.
  if (part === 'torso') ellipse(-7, -11, 0.65, 0.65, cloth);
}
