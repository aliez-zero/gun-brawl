import type { MapDefinition } from '../game/core/types';

type Paint = string | CanvasGradient;

/** Original, deterministic scene artwork, shared by map cards and the arena backdrop. */
export function paintWorld(ctx: CanvasRenderingContext2D, map: MapDefinition): void {
  const theme = map.theme ?? 'training';
  const box = (x: number, y: number, w: number, h: number, fill: Paint, radius: number | number[] = 0): void => {
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
    // Recess distant architecture: no continuous bright bridge line may disguise
    // the open, lethal gaps between the actual fortress platforms.
    ctx.save(); ctx.globalAlpha = 0.62;
    for (let x = -70; x < 1400; x += 120) {
      box(x + 8, 459, 18, 230, '#535c6b');
      ctx.beginPath(); ctx.arc(x + 70, 493, 42, Math.PI, 0); ctx.lineWidth = 14; ctx.strokeStyle = '#535c6b'; ctx.stroke();
    }
    tower(75, 310, 100, 310, '#414d60'); tower(1090, 250, 105, 390, '#414d60');
    tower(905, 325, 80, 310, '#4b5367'); tower(620, 340, 100, 310, '#4d586a');
    tower(382, 282, 90, 365, '#4c5668');
    ctx.beginPath(); ctx.arc(430, 318, 17, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = '#c4b49a88'; ctx.stroke();
    stroke([430, 306, 430, 318, 439, 324], '#d1c1a5', 2);
    stroke([1143, 202, 1143, 160], '#b1a08e', 2); poly([1144, 161, 1182, 172, 1144, 184], '#aa5967');
    ctx.restore();
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
    ctx.save(); ctx.globalAlpha = 0.8;
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
    ctx.restore();
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
    // Only the viewport corners frame the void. A full-width decorative floor
    // would incorrectly suggest that missed docks or the airlock can catch a fall.
    poly([0, 659, 57, 698, 112, 720, 0, 720], '#182b3a');
    poly([1280, 659, 1223, 698, 1168, 720, 1280, 720], '#182b3a');
    stroke([0, 660, 57, 699, 112, 720], '#60849744', 2);
    stroke([1280, 660, 1223, 699, 1168, 720], '#60849744', 2);
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

  // These facades sit behind actors and every landing surface. They are recessed,
  // low-contrast scenery: all maps still use pass-through, one-way platforms.
  // Derive every attachment from its real platform, never a duplicate layout.
  const downwardFade = (y: number, top: string, bottom: string): CanvasGradient => {
    const paint = ctx.createLinearGradient(0, y, 0, 770);
    paint.addColorStop(0, top); paint.addColorStop(1, bottom); return paint;
  };
  for (const p of map.platforms) {
    const bottom = p.y + p.height;
    if (theme === 'citadel') {
      const bridge = /bridge|wall/.test(p.id);
      const court = /court/.test(p.id);
      if (bridge) {
        // Broken masonry and a shallow arch distinguish wall sections from towers.
        const spring = bottom + 43, center = p.x + p.width / 2;
        poly([p.x + 8, bottom, p.x + p.width - 8, bottom, p.x + p.width - 18, spring,
          p.x + p.width - 42, spring - 8, center + 20, bottom + 15, center - 25, bottom + 15,
          p.x + 35, spring + 9, p.x + 13, spring + 2], '#4f5266bd');
        stroke([p.x + 20, spring - 5, center - 24, bottom + 11, center + 23, bottom + 11, p.x + p.width - 25, spring - 12], '#b7a39570', 3);
        stroke([p.x + 20, bottom + 2, p.x + 13, bottom + 75], '#4b4d60', 8);
        stroke([p.x + p.width - 20, bottom + 2, p.x + p.width - 12, bottom + 68], '#4b4d60', 8);
      } else {
        const inset = court ? 14 : Math.min(30, p.width * 0.09);
        const x = p.x + inset, w = p.width - inset * 2;
        const center = p.x + p.width / 2;
        // Join each tower tier to its next lower tier, avoiding stacked transparent
        // facades that would make the castle look like unrelated floating shelves.
        const lowerTier = map.platforms.filter((q) => q.y > p.y && q.x <= center && q.x + q.width >= center && !/wall|bridge/.test(q.id));
        const base = Math.min(770, ...lowerTier.map((q) => q.y));
        const face = ctx.createLinearGradient(0, bottom, 0, base);
        face.addColorStop(0, '#4a5063f0'); face.addColorStop(1, '#394658f0');
        box(x, bottom + 2, w, base - bottom, face);
        box(x, bottom + 2, 8, base - bottom, '#c2aa8c28');
        box(x + w - 11, bottom + 2, 11, base - bottom, '#1a2e3c40');
        for (let y = bottom + 27; y < Math.min(base, 720); y += 35) {
          stroke([x + 8, y, x + w - 8, y], '#d1b9951f');
          for (let sx = x + 25 + (Math.floor(y / 35) % 2) * 25; sx < x + w - 10; sx += 52) stroke([sx, y, sx, Math.min(y + 34, base)], '#192b3b45');
        }
        const arches = Math.max(1, Math.floor(w / 85));
        const gap = w / arches;
        for (let i = 0; i < arches; i++) {
          const ax = x + gap * (i + 0.5), ay = bottom + (court ? 20 : 48);
          const aw = Math.min(court ? 27 : 20, gap * 0.23), ah = Math.min(court ? 92 : 65, base - ay - 8);
          if (ay + 10 > 720 || ah < 24) continue;
          box(ax - aw, ay, aw * 2, ah, '#172d3e80', [aw, aw, 0, 0]);
          stroke([ax - aw + 3, ay + ah, ax - aw + 3, ay + aw + 2], '#bba3843d', 2);
          if (!court) {
            box(ax - 5, ay + 18, 3, 20, '#e5b5734a');
            box(ax + 3, ay + 18, 3, 20, '#e5b57332');
          }
        }
      }
      // Hanging banners never extend above the collision-aligned capstone.
      if (!court) {
        const flagX = p.x + p.width - Math.min(52, p.width * 0.25), flagY = bottom + 12;
        poly([flagX, flagY, flagX + 26, flagY, flagX + 26, flagY + 54, flagX + 13, flagY + 45, flagX, flagY + 54], '#985b69b8');
        stroke([flagX + 13, flagY + 10, flagX + 13, flagY + 33], '#e2ba7675', 2);
        poly([flagX + 13, flagY + 8, flagX + 18, flagY + 17, flagX + 13, flagY + 26, flagX + 8, flagY + 17], '#e2ba7675');
      }
    } else if (theme === 'city') {
      const sign = /sign|billboard/.test(p.id);
      const passage = /walk|bypass|avenue|service/.test(p.id);
      const neon = sign ? '#d991bd' : '#79cdd6';
      if (sign) {
        const x = p.x + 6, y = bottom + 4, w = p.width - 12, h = Math.min(70, p.width * 0.55);
        box(x, y, w, h, '#1c253fe8', 2);
        ctx.strokeStyle = '#d991bd66'; ctx.lineWidth = 2; ctx.strokeRect(x + 6, y + 7, w - 12, h - 14);
        ctx.save(); ctx.beginPath(); ctx.rect(x + 8, y + 8, w - 16, h - 16); ctx.clip();
        ctx.textAlign = 'center'; ctx.font = `bold ${Math.min(20, w / 6)}px Consolas, monospace`;
        ctx.fillStyle = '#e1b2ca'; ctx.fillText(p.x < 640 ? 'NIGHT / 24' : 'SKYLINE', x + w / 2, y + h * 0.62); ctx.restore();
        for (const sx of [x + 18, x + w - 18]) {
          stroke([sx, y + h, sx, y + h + 39], '#52607899', 5);
          stroke([sx, y + h + 36, sx + (sx < 640 ? 25 : -25), y + h + 12], '#52607899', 3);
        }
      } else if (/duct/.test(p.id)) {
        box(p.x + 7, bottom + 3, p.width - 14, 35, '#273d50d9', 6);
        for (let x = p.x + 15; x < p.x + p.width - 12; x += 18) stroke([x, bottom + 8, x, bottom + 29], '#73869150', 2);
        for (const x of [p.x + 18, p.x + p.width - 18]) stroke([x, bottom + 35, x - 17, bottom + 59], '#435c7088', 5);
      } else if (passage) {
        poly([p.x + 7, bottom, p.x + p.width - 7, bottom, p.x + p.width - 16, bottom + 19, p.x + 16, bottom + 19], '#263b4fcc');
        for (let x = p.x + 12; x < p.x + p.width - 28; x += 38) stroke([x, bottom + 2, x + 17, bottom + 17, x + 34, bottom + 2], '#78919870', 2);
        for (const x of [p.x + 24, p.x + p.width - 24]) stroke([x, bottom + 19, x + (x < 640 ? -12 : 12), bottom + 60], '#31485b80', 5);
      } else {
        const x = p.x + 10, w = p.width - 20;
        box(x, bottom + 2, w, 770 - bottom, downwardFade(bottom, '#202e44eb', '#1c2d3b77'));
        box(x, bottom + 2, 7, 770 - bottom, '#697c8b36');
        box(x + w - 17, bottom + 2, 17, 770 - bottom, '#13233555');
        for (let col = 0; col < Math.floor(w / 32); col++) {
          for (let row = 0; row < (720 - bottom - 24) / 29; row++) {
            const lit = (col * 5 + row * 7 + p.x) % 7 < 4;
            const wx = x + 17 + col * 31, wy = bottom + 24 + row * 29;
            box(wx, wy, 10, 15, lit ? ((col + row) % 3 ? '#9bb8c33d' : '#dfb77d4a') : '#0c203c55');
            stroke([wx, wy + 10, wx + 10, wy + 10], '#17263e77');
          }
        }
        const pipeX = x + w - 29;
        stroke([pipeX, bottom + 12, pipeX, 720], '#4e627a60', 3);
        // A vertical sign reads as facade detail, with no implied extra landing edge.
        if (w > 190 && p.y < 550) {
          const signX = x + w - 47;
          box(signX, bottom + 31, 24, 92, '#382d4ec9', 3);
          stroke([signX + 4, bottom + 37, signX + 4, bottom + 117], '#d991bd95', 2);
          ctx.save(); ctx.textAlign = 'center'; ctx.font = 'bold 12px Consolas, monospace'; ctx.fillStyle = '#e7adc8b0';
          for (const [i, letter] of [...'NOVA'].entries()) ctx.fillText(letter, signX + 14, bottom + 51 + i * 19); ctx.restore();
        }
      }
      stroke([p.x + 12, bottom + 2, p.x + p.width - 12, bottom + 2], `${neon}70`, 2);
    } else if (theme === 'starship') {
      if (/reactor/.test(p.id)) {
        const center = p.x + p.width / 2, radius = Math.min(99, p.width * 0.24);
        const coreY = bottom + 83;
        const coreGlow = ctx.createRadialGradient(center, coreY, 5, center, coreY, 150);
        coreGlow.addColorStop(0, '#8df1e42e'); coreGlow.addColorStop(1, '#70e8de00');
        ellipse(center, coreY, 150, 150, coreGlow);
        box(center - radius, bottom + 6, radius * 2, 155, '#183348c7', 24);
        ellipse(center, coreY, radius * 0.68, 57, '#38677d77');
        ellipse(center, coreY, radius * 0.39, 43, '#94dfda4d');
        ctx.beginPath(); ctx.ellipse(center, coreY, radius * 0.76, 65, 0, 0, Math.PI * 2); ctx.lineWidth = 6; ctx.strokeStyle = '#7db5bd77'; ctx.stroke();
        for (const offset of [-1, 1]) {
          stroke([center + offset * (radius - 11), bottom + 16, center + offset * (radius - 11), bottom + 151], '#5a8da280', 7);
          const conduitX = center + offset * (radius + 39);
          stroke([conduitX, bottom + 3, conduitX, bottom + 124, conduitX + offset * 43, bottom + 167], '#355c7190', 16);
          stroke([conduitX, bottom + 3, conduitX, bottom + 124, conduitX + offset * 43, bottom + 167], '#82cbd055', 3);
        }
        ctx.save(); ctx.textAlign = 'center'; ctx.font = '11px Consolas, monospace'; ctx.fillStyle = '#c1d7dc99'; ctx.fillText('ION CORE / 07', center, bottom + 160); ctx.restore();
      } else if (/airlock/.test(p.id)) {
        poly([p.x + 9, bottom, p.x + p.width - 9, bottom, p.x + p.width - 33, bottom + 42, p.x + 33, bottom + 42], '#253f51');
        for (let x = p.x + 30; x < p.x + p.width - 36; x += 35) stroke([x, bottom + 7, x + 13, bottom + 26], '#bbad6966', 5);
      } else {
        const center = p.x + p.width / 2;
        poly([p.x + 7, bottom, p.x + p.width - 7, bottom, p.x + p.width - 28, bottom + 26,
          center + p.width * 0.12, bottom + 52, center - p.width * 0.12, bottom + 52, p.x + 28, bottom + 26], '#243e54c9');
        stroke([p.x + 23, bottom + 5, center - 16, bottom + 39, center + 16, bottom + 39, p.x + p.width - 23, bottom + 5], '#6c9eb265', 3);
        for (let x = p.x + 35; x < p.x + p.width - 25; x += 56) stroke([x, bottom + 3, x + 6, bottom + 17], '#162c4155', 5);
        if (/deck|dock/.test(p.id)) {
          const anchor = p.x < 640 ? 52 : 1228;
          stroke([anchor, bottom + 74, center, bottom + 24], '#233f5399', 18);
          stroke([anchor, bottom + 74, center, bottom + 24], '#6d96ab40', 2);
        }
      }
    }
  }

  // Draw all landing caps last so no facade covers a lower platform. The bright,
  // flat upper edge starts exactly at collision y; no decorative tops are added.
  for (const p of map.platforms) {
    if (theme === 'training') box(p.x + 5, p.y + 8, p.width, p.height, '#07121c44', 4);
    if (theme === 'citadel') {
      const stone = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
      stone.addColorStop(0, '#a49283'); stone.addColorStop(1, '#525367');
      box(p.x, p.y, p.width, p.height, stone, [0, 0, 3, 3]);
      box(p.x, p.y, p.width, 5, '#e4c59a');
      stroke([p.x + 3, p.y + 8, p.x + p.width - 3, p.y + 8], '#3f4256', 1);
      for (let x = p.x + 28; x < p.x + p.width - 4; x += 43) stroke([x, p.y + 8, x - 3, p.y + p.height - 2], '#303b4c88', 1);
      for (const x of [p.x + 10, p.x + p.width - 19]) box(x, p.y + 9, 9, 5, '#e1c59b88', 1);
    } else if (theme === 'city') {
      const sign = /sign|billboard/.test(p.id);
      box(p.x, p.y, p.width, p.height, '#31465a', [0, 0, 3, 3]);
      box(p.x, p.y, p.width, 4, '#bdcbd2');
      box(p.x + 4, p.y + 7, p.width - 8, 3, sign ? '#e4a1cc' : '#83dce1', 1);
      for (let x = p.x + 14; x < p.x + p.width - 14; x += 43) box(x, p.y + 14, 19, 3, '#172a3d', 1);
    } else {
      box(p.x, p.y, p.width, p.height, theme === 'starship' ? '#455f75' : '#3b554b', 4);
      box(p.x + 1, p.y, p.width - 2, 5, theme === 'starship' ? '#b8d7de' : '#b3c794', 2);
      box(p.x + 7, p.y + 7, p.width - 14, 2, theme === 'starship' ? '#89dde0aa' : '#91ac7855', 1);
      for (let x = p.x + 14; x < p.x + p.width - 12; x += 40) {
        box(x, p.y + 13, 22, 3, '#192b37', 1);
        if (theme === 'starship') box(x + 3, p.y + p.height + 3, 14, 3, '#76cde577', 1);
      }
    }
    if (theme !== 'training') {
      for (const side of [-1, 1]) {
        const edge = side < 0 ? p.x : p.x + p.width;
        const probe = edge + side * Math.min(24, p.width * 0.1);
        const catchBelow = map.platforms.some((q) => q.y > p.y && q.x <= probe && q.x + q.width >= probe);
        if (catchBelow) continue;
        // These marks sit inside the platform face; the unbroken landing line
        // remains at collision y. Only edges opening onto uncaught falls are marked.
        const inset = side < 0 ? p.x + 3 : p.x + p.width - 21;
        if (theme === 'citadel') {
          stroke([inset + 3, p.y + 9, inset + 8, p.y + p.height - 4], '#392e3e99', 2);
          stroke([inset + 10, p.y + 10, inset + 14, p.y + p.height - 3], '#d6a36f99', 2);
          stroke([edge - side * 2, p.y + 6, edge - side * 2, p.y + p.height - 5], '#e8b783b3', 2);
        } else {
          const markerY = p.y + 7, markerH = p.height - 10;
          box(inset, markerY, 18, markerH, '#192833');
          ctx.save(); ctx.beginPath(); ctx.rect(inset, markerY, 18, markerH); ctx.clip();
          for (let stripe = -8; stripe < 23; stripe += 9) {
            stroke([inset + stripe, markerY + markerH, inset + stripe + 8, markerY], theme === 'starship' ? '#d5b775' : '#ce9e69', 4);
          }
          ctx.restore();
          if (theme === 'starship') box(edge - side * 4 - 1, p.y + 2, 2, 3, '#edb18a');
        }
      }
    }
  }
  const vignette = ctx.createRadialGradient(690, 360, 210, 640, 360, 800);
  vignette.addColorStop(0, '#07121b00'); vignette.addColorStop(1, '#07121b66'); box(0, 0, 1280, 720, vignette);
  ctx.restore();
}
