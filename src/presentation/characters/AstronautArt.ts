import type { HumanoidPart } from './HumanoidRig';
import type { ArtBrush } from './ArtBrush';

/** A fitted pressure suit: separate joint seals, boots and a compact life pack. */
export function paintAstronaut(part: HumanoidPart, b: ArtBrush): void {
  const { shape, line, ellipse, box, gradient, cloth, light, dark, fabric, steel, rubber, gold } = b;
  switch (part) {
    case 'coatBack':
      box(-17, -27, 14, 29, steel, 3);
      box(-20, -21, 5, 20, '#536c7d', 2);
      box(-14, -23, 7, 5, '#d6ded5');
      line('M-13-21-8-21', '#b1875c', 1.5);
      for (const y of [-13, -9, -5]) line(`M-17 ${y} -12 ${y}`, '#d4dddd', 0.8);
      break;
    case 'torso':
      shape('M-9-23 Q0-26 9-23 L13-17 10 2-10 2-13-16Z', fabric);
      shape('M-5-28 5-28 6-22-6-22Z', rubber);
      shape('M-8-24 Q0-20 8-24 L10-20 Q0-15-10-20Z', '#b8c9ce');
      line('M-6-22 Q0-19 7-22', '#f0ead4', 0.9);
      box(-6.5, -16, 13, 10, steel, 1.8);
      box(-4.5, -14.5, 8.5, 4, '#324e5b');
      line('M-3-12.5 0-12.5 1-13.5 2.5-12', '#a9dcce', 0.7);
      ellipse(-3.5, -8, 0.9, 0.9, '#e5ad68'); ellipse(0, -8, 0.8, 0.8, '#9fd6b7');
      line('M-9-14 Q-15-7-8-1', '#263b48', 2.3);
      line('M-9-14 Q-15-7-8-1', '#b4c4be', 1.2);
      shape('M-10-1 10-1 10 3-10 3Z', '#5a6d7c');
      box(-2, -1, 5, 4, '#d7b578');
      line('M7-15 8-8 M-8-5-5-3', light, 0.65);
      break;
    case 'coatFront':
      box(-2, 1, 6, 8, fabric, 1.5);
      line('M-1 3 3 3', '#d7a970', 1.2);
      ellipse(1, 6, 0.8, 0.8, '#859eaa');
      break;
    case 'scarfTail':
      shape('M-2-1 3-1 2 3-1 4Z', '#7d9ca7');
      ellipse(0.5, 1, 0.7, 0.7, gold);
      break;
    case 'thigh': case 'thighBack':
      shape('M-4.4 0 Q0-3 4.4 0 L3.6 15-3.5 16-4.5 7Z', part === 'thighBack' ? gradient(light, dark, '#5d7584') : fabric);
      line('M-2 2-2 11 M2.5 3 2.4 10', '#edf0e4', 0.7);
      shape('M-4 13 4 13 3.5 16-3.5 16Z', rubber);
      break;
    case 'shin': case 'shinBack':
      shape('M-3.8 0 Q0-2.5 3.8 0 L3 15-3 15Z', fabric);
      shape('M-3.8 0 3.8 0 3.5 4-3.5 4Z', '#5c788b');
      line('M-2 1 2 1 M-2 3 2 3', '#aebfc5', 0.55);
      box(-2, 7, 4, 4, '#8fa8b2');
      break;
    case 'boot': case 'bootBack':
      shape('M-4-6 3-6 3.5-0.5 7 1 7.5 4-4.5 4Z', steel);
      shape('M-4.5 3 7.5 3 7.5 5-4.5 5Z', rubber);
      line('M-2-4 2-4 M-2-1 2-1 M1 1 5 2', '#e6e4d8', 0.75);
      break;
    case 'upper': case 'upperBack':
      shape('M-4 0 Q0-4 4 0 L3.6 16.5-3.4 16.5Z', fabric);
      shape('M-4 0 Q0-3 4 0 L4 4-4 4Z', steel);
      box(-2.5, 6, 5, 3, '#9fadb2'); line('M-1.5 7.3 1.5 7.3', '#e2b472', 0.8);
      shape('M-3.5 13 3.5 13 3 16.5-3 16.5Z', rubber);
      break;
    case 'fore': case 'foreBack':
      shape('M-3.3 0 Q0-2.5 3.3 0 L2.5 15.5-2.5 15.5Z', fabric);
      line('M-2 3-1.5 10', '#f3f0df', 0.65);
      shape('M-2.8 11 2.8 11 2.5 15.5-2.5 15.5Z', '#5a7788');
      line('M-1.5 12.5 1.5 12.5', '#ccac79', 0.9);
      break;
    case 'hand': case 'handBack':
      shape('M-2.5-1.5 Q1-2.5 3 0 L3 2.5 0.5 3.5-2.5 2Z', steel);
      line('M0 0 2 0 M0 1.5 2 1.5', '#e4e7db', 0.5);
      break;
    default: break;
  }
  if (part === 'torso') ellipse(7, -18, 0.7, 0.7, cloth);
}
