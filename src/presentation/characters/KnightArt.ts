import type { HumanoidPart } from './HumanoidRig';
import type { ArtBrush } from './ArtBrush';

/** Armor overlaps at the joints instead of replacing arms and legs with blocks. */
export function paintKnight(part: HumanoidPart, b: ArtBrush): void {
  const { shape, line, ellipse, box, gradient, dark, fabric, skinDark, steel, gold, leather } = b;
  switch (part) {
    case 'coatBack':
      shape('M-8-24 Q0-27 9-23 L13 14 2 18-8 14-15 16-17 11Z', gradient('#c4787c', '#884457', '#4d324b'));
      shape('M-9-20-13 11-9 13-4-21Z', '#b36570', false);
      line('M-14 12-8 15 2 18 11 14', '#d2b687', 0.9);
      line('M-5-19-5 6 M3-19 6 11', '#a75965', 0.7);
      break;
    case 'torso':
      shape('M-9-23 Q0-26 9-23 L12-17 9 3-9 3-12-17Z', '#455567');
      shape('M-3-28 4-28 4-22-3-22Z', skinDark);
      shape('M-7-24 Q0-20 7-24 L10-20 6-16-6-16-10-20Z', steel);
      shape('M-9-19 0-16 9-19 10-6 3-2-8-5Z', steel);
      shape('M0-16 9-19 10-6 3-2 0-5Z', '#628595', false);
      line('M-7-17-6-7 0-5 M1-14 7-16', '#e0e2d0', 0.8);
      shape('M-5-15 0-13 4-15 3-9 0-7-4-10Z', fabric);
      shape('M-1-13 1-13 1-9-1-9Z', gold, false);
      shape('M-10-2 10-2 9 2-9 2Z', leather);
      box(-1.5, -2.5, 5, 4, gold, 0.6); box(-0.4, -1.5, 2.8, 2, leather, 0.3);
      for (const x of [-7, 7]) ellipse(x, -18, 0.6, 0.6, gold);
      break;
    case 'coatFront':
      shape('M-13 1-3 0 3 2 2 10-3 12-12 9Z', fabric);
      line('M-10 3-9 8-3 10 M-2 2-2 8', '#d8be92', 0.7);
      shape('M-2 1 2 2 4 7 0 8Z', steel);
      break;
    case 'scarfTail':
      shape('M-4 0 3-1 2 3-3 3Z', fabric);
      ellipse(1, 1, 1, 1, gold, true);
      break;
    case 'thigh': case 'thighBack':
      shape('M-4 0 Q0-3 4 0 L3.5 15-3 16Z', dark);
      shape('M-3.5 1 3.5 1 3 11-2.5 12-4 8Z', steel);
      line('M-2 2-1.5 8', '#e4e4d2', 0.7);
      break;
    case 'shin': case 'shinBack':
      shape('M-3 0 Q0-2 3 0 L2.5 15-2.5 15Z', '#45556a');
      shape('M-3.8-0.5 0-2 3.8 0 2.7 4 0 5-3 3Z', steel);
      shape('M-2.5 5 2.5 5 3 14-2.8 15Z', steel);
      line('M0 6 0 13 M-2 0 0 2 2 0', '#dde2d4', 0.7);
      break;
    case 'boot': case 'bootBack':
      shape('M-3.5-6 3-6 3-0.5 7 1.8 7.5 4-4 4Z', steel);
      shape('M-4 3.5 7.5 3.5 7.5 5-4 5Z', '#2a3541', false);
      line('M-2-4 2-4 M0 0 4 2 M-1 1 3 3', '#e3ddc8', 0.7);
      break;
    case 'upper': case 'upperBack':
      shape('M-3.8 0 Q0-3 3.8 0 L3 16.5-3 16.5Z', '#435164');
      shape('M-5-1 Q0-5 5-1 L5 5 2 7-4 5Z', steel);
      line('M-3-1 2-2 4 1 M-3 3 3 4', '#dce0cb', 0.7);
      ellipse(-2, 1, 0.6, 0.6, gold);
      shape('M-3 8 3 8 2.7 14-2.7 15Z', steel);
      break;
    case 'fore': case 'foreBack':
      shape('M-2.8 0 Q0-2.4 2.8 0 L2.4 15.5-2.4 15.5Z', '#455366');
      shape('M-3.2-0.5 0-2 3.2 0 2.5 4-2.5 4Z', steel);
      shape('M-2.7 5 2.7 5 2.5 15-2.5 15Z', steel);
      line('M-1.5 6-1 12 M-2 13 2 13', '#dce1cf', 0.7);
      break;
    case 'hand': case 'handBack':
      shape('M-2.5-1.5 Q1-2 3 0 L3 2.5 1 3.5-2.5 2Z', steel);
      line('M0 0.5 2.5 0.5 M0 1.8 2 1.8', '#dbe0ce', 0.55);
      break;
    default: break;
  }
}
