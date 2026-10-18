import type { CharacterAppearance } from '../../game/core/types';
import { artBrush, tint } from './ArtBrush';
import { paintCowboyPart } from './CowboyArt';

/** Identity follows style; changing a coat or helmet does not replace the face. */
export function paintCharacterHead(ctx: CanvasRenderingContext2D, look: CharacterAppearance): void {
  if (look.style === 'cowboy') { paintCowboyPart(ctx, look, 'head'); return; }
  const { shape, line, ellipse, gradient, skin, skinLight, skinDark } = artBrush(ctx, look);
  const ronin = look.style === 'ronin', operative = look.style === 'operative';
  const astronaut = look.style === 'astronaut';
  const hair = ronin ? '#30303a' : operative ? '#292e33' : astronaut ? '#593d38' : '#544842';
  if (ronin) {
    ellipse(-6, -12, 4.2, 4, hair, true);
    shape('M-8-12-10-16-5-18-2-15Z', hair);
    line('M-8-15-4-15', '#9e8d71', 0.9);
  }
  if (astronaut) shape('M-7-10 Q-9-16-1-16 Q8-15 8-8 L8 4-6 5Z', hair);
  shape(ronin
    ? 'M-6-10 Q-5-14 1-14 Q7-14 8-8 L8-4 10-2 8-0.5 7 2 Q3 5-1 4 L-5 0Z'
    : astronaut
      ? 'M-6-10 Q-5-14 1-14 Q7-14 8-8 L8-4 9.5-2 8-0.5 7 2 Q3 5-1 3.8 L-5 0Z'
      : 'M-7-10 Q-5-15 1-14 Q8-14 8-8 L8-4 10-2 8.5-0.5 7 3 2 5-3 3-6 0Z', gradient(skinLight, skin, skinDark, -7, -14, 17, 20));
  ellipse(-6.5, -3, 1.8, 2.3, skinDark, true);
  line('M-7-3.5-6-2.5-6.5-1.5', skinLight, 0.6);
  if (ronin) {
    shape('M-6-5-8-7 Q-9-15-2-15 Q5-17 8-10 L5-10 1-12-3-10-4-3-6-1Z', hair);
    line('M-5-12-1-13 3-12', '#69616a', 0.65);
  } else if (operative) {
    shape('M-6-4-8-8 Q-7-15-1-15 L6-14 8-10 5-9 1-11-4-9-4-3Z', hair);
    line('M-5-12 1-13 5-11', '#65706b', 0.55);
  } else if (astronaut) {
    shape('M-7-4-8-9 Q-7-16 1-15 Q7-15 8-9 L4-10 0-12-3-9-4-3Z', hair);
    line('M-4-12-1-13 3-12', '#a27860', 0.65);
  } else {
    shape('M-7-4-8-10 Q-7-16 0-15 L6-14 8-10 4-10 0-12-4-10-4-4Z', hair);
    line('M-5-13-1-14 M2-13 5-12', '#a29580', 0.65);
  }
  // Whites, pupils and brow direction stay readable through the open helmets.
  line(ronin ? 'M-2.5-8 0-7.5 M4.5-8 7-8.5' : 'M-2.5-8 0-8.5 M4.5-8.5 6.8-8', hair, astronaut ? 0.65 : 0.9);
  ellipse(-0.6, -5.7, 1, astronaut ? 1.1 : 0.85, '#eee8d9');
  ellipse(5.4, -5.8, 0.8, astronaut ? 1 : 0.8, '#eee8d9');
  ellipse(-0.2, -5.6, 0.5, 0.8, '#2c3336'); ellipse(5.7, -5.7, 0.45, 0.7, '#2c3336');
  line('M3.8-5 3.8-2.5 5.5-2', skinDark, 0.6);
  line(astronaut ? 'M0.5 1.3 Q2.5 2.4 4.6 1' : 'M0.6 1.8 4.6 1.5', '#765044', 0.65);
  if (ronin) {
    line('M5-3 6.2-0.5 M4.5-2 6-2.5', '#a06a59', 0.55);
    line('M-1 2 0 2.8', skinDark, 0.5);
  } else if (operative) {
    shape('M-3.5-7.5 1.8-7.5 1.5-3.5-3-3.5Z', '#76a29e44');
    shape('M3.7-7.5 7.7-7.5 7.5-3.5 3.7-3.5Z', '#76a29e44');
    line('M-3.5-7.5 1.8-7.5 1.5-3.5-3-3.5Z M3.7-7.5 7.7-7.5 7.5-3.5 3.7-3.5Z M1.8-6.5 3.7-6.5', '#35484b', 0.65);
    line('M-2-6.5 0-6.5 M4.5-6.5 6-6.5', '#c3dbce', 0.5);
    ellipse(-7, -3, 2, 2.4, '#45575a', true);
    line('M-7-1-5 2-1 2.5', '#34484c', 0.7); ellipse(-0.6, 2.5, 1.2, 0.6, '#82948b');
  } else if (astronaut) {
    ellipse(-3, -0.5, 1.4, 0.55, tint(look.skin, -0.06));
    ellipse(-6.5, -1, 0.7, 0.7, '#b4bdc2');
  } else {
    shape('M-4 0-1 1 1 2 5 1 7 0 6 3 2 5-2 3Z', '#76645888', false);
    line('M-2 1-1 2 M0 3 1 3.4 M4 3 5 2.5', '#665447', 0.55);
    line('M5-9 6-7.5', '#c49a7d', 0.6);
  }
}

/** Every hat uses the same head socket and leaves room for the eyes and jaw. */
export function paintHeadwear(ctx: CanvasRenderingContext2D, look: CharacterAppearance): void {
  if (look.hat === 'none') return;
  if (look.hat === 'cowboy' || look.hat === 'beret') { paintCowboyPart(ctx, look, 'hat'); return; }
  const { shape, line, ellipse, box, gradient, steel, gold } = artBrush(ctx, look);
  if (look.hat === 'straw') {
    shape('M-23 0-4-11 2-11 23-1 Q7 5-13 3Z', gradient('#e6d1a5', '#b7a06f', '#786b52', -23, -11, 46, 15));
    for (const x of [-17, -10, -3, 5, 12, 19]) line(`M-2-9 ${x} 0`, '#8e7b57', 0.5);
    line('M-20 1 Q0 5 20 0', '#f2dfb1', 0.8);
    shape('M-12 3 Q0 5 13 2 L7 4-6 4Z', '#6f614c', false);
  } else if (look.hat === 'space') {
    ctx.beginPath(); ctx.ellipse(0, 8.5, 13.5, 17, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#7bb4bf18'; ctx.fill();
    ctx.strokeStyle = '#303f4c'; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.strokeStyle = '#c3d5d7'; ctx.lineWidth = 1.8; ctx.stroke();
    line('M-8-3 Q-12 2-11 9 M-6-5 Q-2-7 3-6', '#e1f0e4aa', 1);
    shape('M-11 19 Q0 23 12 18 L10 24 Q0 28-10 24Z', steel);
    box(-15, 6, 5, 7, '#829fa9', 1.5); ellipse(-12.5, 9.5, 1, 1.5, '#ddbb7d');
    line('M7 22 10 22', '#91d4bf', 1.1);
  } else {
    shape('M-4-3 Q-12-8-8-10 Q-2-12 3-6 L5-1Z', '#b56a74');
    line('M-7-9-2-5', '#deb29b', 0.7);
    shape('M-10 2-9-4 Q0-10 9-4 L11 2 7 5-7 5Z', steel);
    shape('M0-7 3-6 4 4 0 5Z', '#e4dfc6');
    line('M-8 1 8 1', '#d3c39a', 0.9);
    shape('M-9 3-5 4-5 14-2 19-7 19-11 13Z', steel);
    shape('M8 4 11 4 12 14 8 18 7 14Z', '#6f8b98');
    line('M-8 7-7 13 M9 7 9.5 12', '#dce1d2', 0.6);
    ellipse(-7.5, 5, 0.8, 0.8, gold); ellipse(9, 5, 0.7, 0.7, gold);
  }
}
