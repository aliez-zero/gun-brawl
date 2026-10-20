import type { HumanoidPart } from './HumanoidRig';
import type { ArtBrush } from './ArtBrush';

/** Close-fitting uniform, a vest with readable pouches and segmented knee pads. */
export function paintOperative(part: HumanoidPart, b: ArtBrush): void {
  const { shape, line, ellipse, box, gradient, light, dark, fabric, skin, skinDark, gold, rubber } = b;
  switch (part) {
    case 'coatBack':
      box(-12, -22, 8, 20, gradient('#64716b', '#394c4d', '#26343d'), 2);
      line('M-11-16-6-16 M-11-13-6-13', '#8d9a88', 0.7);
      break;
    case 'torso':
      shape('M-8-24 Q0-26 8-23 L11-18 9 3-9 3-12-17Z', fabric);
      shape('M-3-28 4-28 4-21-3-21Z', skinDark);
      shape('M-8-23-3-21 5-21 9-23 10-3-9-3Z', gradient('#657570', '#3a4c4b', '#26353e'));
      shape('M-7-23-4-22-4-9-7-10Z', '#9aab95');
      shape('M5-22 8-22 7-10 4-10Z', '#859482');
      box(-6.5, -17, 12, 5, '#394950');
      line('M-5-15.5 3-15.5', '#a6c0b4', 0.8);
      for (const x of [-7, -1, 5]) { box(x, -10, 4.5, 7, '#51635b'); line(`M${x + 1}-8 ${x + 3}-8`, '#98a78d', 0.55); }
      shape('M-10-1 10-1 9 3-10 3Z', '#333c41');
      box(-1.5, -1.5, 4.5, 4, '#8f9d98'); box(-0.5, -0.5, 2.5, 2, rubber, 0.3);
      break;
    case 'coatFront':
      box(-1, 1, 5, 9, '#394b4c', 1.5);
      line('M0 4 3 4 M0 6 3 6', '#879c8b', 0.55);
      shape('M-3 2-1 2-1 13-3 13Z', '#343e42');
      break;
    case 'scarfTail':
      shape('M-3-2 3-2 2 2-2 2Z', rubber);
      line('M-2 0 1 0', '#8b9e8d', 0.6);
      break;
    case 'thigh': case 'thighBack':
      shape('M-3.8 0 Q0-3 3.8 0 L3 15-3 16Z', part === 'thighBack' ? dark : fabric);
      box(-2, 5, 4.5, 5, '#4b5e54'); line('M-1 6 1.5 6', light, 0.5);
      break;
    case 'shin': case 'shinBack':
      shape('M-3 0 Q0-2 3 0 L2 14-2 15Z', fabric);
      shape('M-3.4-0.5 Q0-2 3.4-0.5 L2.8 5-2.5 5Z', rubber);
      line('M-1.5 1 1.5 1 M-1.5 3 1 3', '#9aa9a3', 0.6);
      break;
    case 'boot': case 'bootBack':
      shape('M-3.5-6 3-6 3 0 6.5 1.8 7 4.5-4 4.5Z', gradient('#68716c', '#3b4849', '#27313a'));
      shape('M-4 3.5 7 3.5 7 5-4 5Z', '#202d36', false);
      for (const y of [-4, -2, 0]) line(`M-1.8 ${y} 1.6 ${y}`, '#9eab9e', 0.55);
      break;
    case 'upper': case 'upperBack':
      shape('M-3.8 0 Q0-3.5 3.8 0 L3 16.5-3 16.5Z', fabric);
      shape('M-3.5 1 3.5 1 3 5-3 5Z', '#66766b');
      if (part === 'upper') { box(-2.2, 5, 4, 4.5, '#b0b8a5'); line('M-1.2 7 0.8 7', '#4a6257', 0.8); }
      break;
    case 'fore': case 'foreBack':
      shape('M-2.8 0 Q0-2 2.8 0 L2 15.5-2 15.5Z', fabric);
      shape('M-2.8 10 2.5 10 2 15.5-2 15.5Z', rubber);
      if (part === 'fore') { box(-2.8, 9, 5.5, 3.5, '#536e73'); line('M-1.5 10.5 1.5 10.5', '#a6d3bc', 0.7); }
      break;
    case 'hand': case 'handBack':
      shape('M-2-1.5 Q1-2 2.5 0 L3 2 1 3-2 2Z', rubber);
      shape('M0-0.5 2-0.5 2.5 1 0 1Z', skin, false);
      line('M0 1.8 2 1.8', skinDark, 0.5);
      break;
    default: break;
  }
  if (part === 'torso') ellipse(-5, -19, 0.65, 0.65, gold);
}
