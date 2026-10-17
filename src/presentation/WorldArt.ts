import type { MapDefinition } from '../game/core/types';

type Paint = string | CanvasGradient;

/** Original, deterministic scene artwork, shared by map cards and the arena backdrop. */
export function paintWorld(ctx: CanvasRenderingContext2D, map: MapDefinition): void {
  const theme = map.theme ?? 'training';
  const box = (x: number, y: number, w: number, h: number, fill: Paint, radius = 0): void => {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = fill; ctx.fill();
  };
  const poly = (points: number[], fill: Paint): void => {
    ctx.beginPath(); ctx.moveTo(points[0]!, points[1]!);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  };
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: Paint): void => {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  };
  const stroke = (points: number[], color: string, width = 1): void => {
    ctx.beginPath(); ctx.moveTo(points[0]!, points[1]!);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  };
  const gradient = (top: string, mid: string, bottom: string): CanvasGradient => {
    const paint = ctx.createLinearGradient(0, 0, 0, 720);
    paint.addColorStop(0, top); paint.addColorStop(0.52, mid); paint.addColorStop(1, bottom); return paint;
  };
  ctx.save();
  ctx.fillStyle = theme === 'citadel' ? gradient('#263746', '#8e6870', '#d3ad8f')
    : theme === 'city' ? gradient('#121c35', '#3c355b', '#30576a')
      : theme === 'starship' ? gradient('#070f23', '#18294b', '#25404c') : gradient('#142c30', '#25483e', '#192f30');
  ctx.fillRect(0, 0, 1280, 720);

  if (theme === 'citadel') {
    const glow = ctx.createRadialGradient(958, 167, 15, 958, 167, 285);
    glow.addColorStop(0, '#ffddb97d'); glow.addColorStop(1, '#ffcc9900');
    ellipse(958, 167, 285, 285, glow); ellipse(958, 167, 77, 77, '#efd1ab');
    for (let layer = 0; layer < 3; layer++) {
      const points = [0, 720, 0, 375 + layer * 70];
      for (let x = 0; x <= 1360; x += 85) points.push(x, 300 + layer * 88 + Math.sin(x * 0.008 + layer) * 70 + Math.cos(x * 0.018) * 33);
      points.push(1280, 720);
      poly(points, ['#727382', '#696b7b', '#555e70'][layer]!);
    }
    const tower = (x: number, y: number, w: number, h: number, fill: string): void => {
      box(x, y, w, h, fill);
      for (let bx = x; bx < x + w; bx += 19) box(bx, y - 12, 11, 16, fill);
      poly([x - 8, y + 2, x + w / 2, y - 55, x + w + 8, y + 2], '#41475b');
      box(x + 5, y + 8, w - 10, 5, '#a29a974d');
      for (let row = y + 30; row < y + h - 20; row += 48) {
        box(x + w / 2 - 5, row, 10, 22, '#d6b48a65', 5);
      }
    };
    // Distant bridges and towers occupy a separate visual depth from playable platforms.
    for (let x = -70; x < 1400; x += 120) {
      box(x, 445, 120, 18, '#535c6b');
      box(x + 8, 459, 18, 230, '#535c6b');
      ctx.beginPath(); ctx.arc(x + 70, 493, 42, Math.PI, 0); ctx.lineWidth = 14; ctx.strokeStyle = '#535c6b'; ctx.stroke();
    }
    tower(75, 310, 100, 310, '#414d60'); tower(1090, 250, 105, 390, '#414d60');
    tower(905, 325, 80, 310, '#4b5367'); tower(620, 340, 100, 310, '#4d586a');
    tower(382, 282, 90, 365, '#4c5668');
    ctx.beginPath(); ctx.arc(430, 318, 17, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = '#c4b49a88'; ctx.stroke();
    stroke([430, 306, 430, 318, 439, 324], '#d1c1a5', 2);
    stroke([1143, 202, 1143, 160], '#b1a08e', 2); poly([1144, 161, 1182, 172, 1144, 184], '#aa5967');
    for (let i = 0; i < 9; i++) {
      const x = i * 175 - 40;
      ellipse(x, 660 + Math.sin(i) * 25, 160, 36, '#c1b4ad40');
      ellipse(x + 90, 704, 180, 35, '#dac6b647');
    }
    for (let i = 0; i < 7; i++) {
      const x = 740 + i * 25, y = 105 + Math.sin(i * 1.8) * 17;
      stroke([x - 4, y, x, y + 2, x + 5, y - 1], '#42495988', 1.2);
    }
  } else if (theme === 'city') {
    const moon = ctx.createRadialGradient(1010, 156, 5, 1010, 156, 170);
    moon.addColorStop(0, '#b1e1e354'); moon.addColorStop(1, '#7abed500');
    ellipse(1010, 156, 170, 170, moon); ellipse(1010, 156, 53, 53, '#c1d0d6');
    ellipse(1024, 142, 49, 49, '#52607b');
    for (let layer = 0; layer < 3; layer++) {
      for (let i = 0; i < 18; i++) {
        const x = i * 83 - 25 + layer * 19, h = 130 + ((i * 71 + layer * 113) % 255);
        const y = 640 - h + layer * 28, w = 55 + (i % 3) * 15;
        box(x, y, w, h + 130, ['#323750', '#28344b', '#203246'][layer]!);
        if (i % 3 === 0) stroke([x + w / 2, y, x + w / 2, y - 35], '#6b7180', 2);
        for (let row = 0; row < h / 18; row++) for (let col = 0; col < w / 14 - 1; col++) {
          if ((row * 3 + col * 7 + i * 11 + layer) % 6 < 3) box(x + 7 + col * 14, y + 13 + row * 18, 4, 6, (row + i) % 3 ? '#a8bad047' : '#d9b28660');
        }
        if (layer === 2 && i % 4 === 1) {
          box(x + w - 13, y + 20, 10, 48, '#b27a9b77', 2);
          stroke([x + w - 10, y + 25, x + w - 10, y + 63], '#f1a1c6', 1.2);
        }
      }
    }
    stroke([0, 185, 260, 208, 430, 191, 600, 204], '#69728755', 2);
    stroke([1080, 302, 1190, 274, 1280, 283], '#7ca6ad55', 2);
    const haze = ctx.createLinearGradient(0, 520, 0, 720); haze.addColorStop(0, '#407f9400'); haze.addColorStop(1, '#407f945c');
    box(0, 520, 1280, 200, haze);
    ctx.font = 'bold 25px Consolas, monospace'; ctx.fillStyle = '#b8ced535'; ctx.fillText('MIDNIGHT DISTRICT', 800, 675);
  } else if (theme === 'starship') {
    for (let i = 0; i < 180; i++) {
      const x = (i * 179 + 83) % 1280, y = (i * 89 + 31) % 700;
      ellipse(x, y, i % 13 === 0 ? 1.6 : 0.8, i % 13 === 0 ? 1.6 : 0.8, i % 4 ? '#c6dceb60' : '#ebc4af99');
    }
    const planet = ctx.createRadialGradient(884, 246, 15, 970, 285, 195);
    planet.addColorStop(0, '#b6b8d2'); planet.addColorStop(0.5, '#74749e'); planet.addColorStop(1, '#303858');
    ellipse(970, 285, 175, 175, planet);
    ctx.save(); ctx.translate(970, 285); ctx.rotate(-0.34);
    ctx.beginPath(); ctx.ellipse(0, 0, 265, 50, 0, 0, Math.PI * 2); ctx.lineWidth = 18; ctx.strokeStyle = '#a7b7c244'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, 278, 53, 0, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = '#d8d7ce66'; ctx.stroke(); ctx.restore();
    ellipse(748, 147, 23, 23, '#c4c5cc8c');
    // Structural ribs turn the scene into a ship interior rather than an open star field.
    const beam = '#263d50';
    poly([0, 0, 1280, 0, 1280, 40, 1190, 65, 90, 65, 0, 40], beam);
    poly([0, 0, 45, 0, 98, 140, 72, 570, 0, 660], '#203647');
    poly([1280, 0, 1235, 0, 1182, 140, 1208, 570, 1280, 660], '#203647');
    stroke([45, 70, 100, 152, 77, 561], '#73a8bb66', 3);
    stroke([1235, 70, 1180, 152, 1204, 561], '#73a8bb66', 3);
    stroke([130, 66, 180, 145, 172, 430], '#43607577', 12);
    stroke([1150, 66, 1100, 145, 1108, 430], '#43607577', 12);
    for (let x = 250; x < 1100; x += 160) box(x, 39, 67, 4, '#a8dfdf99', 2);
    box(0, 691, 1280, 29, '#182b3a');
    for (let x = 0; x < 1280; x += 64) stroke([x, 720, x + 25, 693], '#60849744', 1);
    ctx.font = '13px Consolas, monospace'; ctx.fillStyle = '#9bc6ce77'; ctx.fillText('ARK 07  /  OBSERVATION DECK', 78, 105);
  } else {
    for (let x = 0; x < 1280; x += 64) stroke([x, 0, x, 720], '#a4ddbc0a');
    for (let y = 0; y < 720; y += 64) stroke([0, y, 1280, y], '#a4ddbc0a');
    const halo = ctx.createRadialGradient(960, 220, 15, 960, 220, 300);
    halo.addColorStop(0, '#a8cf9e20'); halo.addColorStop(1, '#a8cf9e00'); ellipse(960, 220, 300, 300, halo);
    for (let i = 0; i < 17; i++) {
      const h = 130 + ((i * 73) % 210); box(i * 83 - 15, 720 - h, 65, h, '#12292b');
      box(i * 83 + 5, 740 - h, 4, 15, '#91b99733');
    }
    ctx.beginPath(); ctx.arc(950, 250, 170, 0, Math.PI * 2); ctx.strokeStyle = '#93bd9c18'; ctx.lineWidth = 2; ctx.stroke();
  }

  // Every visible platform is drawn from the exact geometry used by the simulation.
  for (const p of map.platforms) {
    box(p.x + 5, p.y + 8, p.width, p.height, '#07121c44', 4);
    if (theme === 'citadel') {
      const stone = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
      stone.addColorStop(0, '#8e817d'); stone.addColorStop(1, '#4e515c');
      box(p.x, p.y, p.width, p.height, stone, 3);
      box(p.x - 2, p.y, p.width + 4, 5, '#d9c39b', 2);
      stroke([p.x + 3, p.y + 7, p.x + p.width - 3, p.y + 7], '#393f4d', 1);
      for (let x = p.x + 30; x < p.x + p.width; x += 46) stroke([x, p.y + 8, x - 3, p.y + p.height], '#303b4c77', 1);
      for (const x of [p.x + 18, p.x + p.width - 32]) {
        poly([x, p.y + p.height, x + 16, p.y + p.height, x + 11, p.y + p.height + 22, x + 6, p.y + p.height + 22], '#535666');
      }
      if (p.width < 400) {
        box(p.x + p.width - 43, p.y + p.height + 2, 21, 32, '#95515c');
        poly([p.x + p.width - 43, p.y + p.height + 30, p.x + p.width - 22, p.y + p.height + 30, p.x + p.width - 22, p.y + p.height + 41, p.x + p.width - 32, p.y + p.height + 35, p.x + p.width - 43, p.y + p.height + 41], '#95515c');
      }
    } else if (theme === 'city') {
      box(p.x, p.y, p.width, p.height, '#293948', 3); box(p.x - 2, p.y, p.width + 4, 5, '#9ab8c3', 2);
      box(p.x + 7, p.y + 6, p.width - 14, 2, '#7fe3dd88', 1);
      box(p.x + 9, p.y + p.height, p.width - 18, p.width > 900 ? 90 : 52, '#1e2f405c', 2);
      for (let x = p.x + 24; x < p.x + p.width - 15; x += 32) {
        box(x, p.y + p.height + 12, 8, 12, '#b7c6b34a', 1);
        if (p.width > 900) box(x, p.y + p.height + 39, 8, 12, '#8ec3d44a', 1);
      }
      for (let x = p.x + 12; x < p.x + p.width - 8; x += 48) box(x, p.y + 12, 26, 3, '#15232e', 1);
    } else {
      box(p.x, p.y, p.width, p.height, theme === 'starship' ? '#3c5365' : '#3b554b', 4);
      box(p.x + 1, p.y, p.width - 2, 5, theme === 'starship' ? '#a9c9d5' : '#b3c794', 2);
      box(p.x + 7, p.y + 7, p.width - 14, 2, theme === 'starship' ? '#79c8d388' : '#91ac7855', 1);
      for (let x = p.x + 14; x < p.x + p.width - 12; x += 40) {
        box(x, p.y + 13, 22, 3, '#192b37', 1);
        if (theme === 'starship') box(x + 3, p.y + p.height + 3, 14, 3, '#76cde577', 1);
      }
    }
  }
  const vignette = ctx.createRadialGradient(690, 360, 210, 640, 360, 800);
  vignette.addColorStop(0, '#07121b00'); vignette.addColorStop(1, '#07121b66'); box(0, 0, 1280, 720, vignette);
  ctx.restore();
}
