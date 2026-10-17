import { APPEARANCE_PRESETS, HEADWEAR, OUTFIT_COLORS, SKIN_TONES } from '../../content/appearances';
import type { CharacterAppearance, HumanSlot } from '../../game/core/types';
import { colorCss, paintCharacter } from '../../presentation/CharacterArt';
import './appearance.css';

export function appearanceEditor(slot: HumanSlot, look: CharacterAppearance, nextRound: boolean): string {
  const preset = APPEARANCE_PRESETS.find((entry) => entry.id === look.style)!;
  return `
    <div class="studio-toolbar"><div class="player-tabs" role="group" aria-label="选择编辑的玩家">${([1, 2] as const).map((id) => `<button data-action="appearance-slot" data-slot="${id}" aria-pressed="${slot === id}" class="${slot === id ? 'active' : ''}">P${id} <span>玩家 ${id}</span></button>`).join('')}</div><span class="saved-note"><i></i> 自动保存${nextRound ? ' · 下局生效' : ''}</span></div>
    <div class="studio-layout">
      <div class="character-paper" style="--look-color:${colorCss(look.color)}">
        <div class="paper-topline"><span>CHARACTER / 0${slot}</span><span>✦</span></div>
        <canvas class="character-preview" width="560" height="600" role="img" aria-label="玩家 ${slot} 当前外观预览"></canvas>
        <div class="paper-caption"><small>${preset.english}</small><strong>${preset.name}</strong><span>${preset.description}</span></div>
        <div class="paper-bottomline"><span>PLAYER ${slot}</span><span>装备就绪 ↗</span></div>
      </div>
      <div class="wardrobe-controls">
        <div class="option-heading"><strong>01 <span>选择风格</span></strong><small>也可以自由混搭</small></div>
        <div class="style-presets" role="group" aria-label="角色风格">${APPEARANCE_PRESETS.map((entry) => `<button class="style-preset ${look.style === entry.id ? 'active' : ''}" data-action="look-preset" data-value="${entry.id}" aria-pressed="${look.style === entry.id}"><canvas width="160" height="180" data-portrait="${entry.id}" aria-hidden="true"></canvas><span>${entry.name}</span></button>`).join('')}</div>
        <div class="option-heading"><strong>02 <span>头饰与服装</span></strong></div>
        <div class="look-chips hat-chips" role="group" aria-label="选择头饰">${HEADWEAR.map((hat) => `<button data-action="look-field" data-field="hat" data-value="${hat.id}" aria-pressed="${look.hat === hat.id}" class="${look.hat === hat.id ? 'active' : ''}">${hat.name}</button>`).join('')}</div>
        <div class="look-chips" role="group" aria-label="选择服装">${APPEARANCE_PRESETS.map((entry) => `<button data-action="look-field" data-field="outfit" data-value="${entry.id}" aria-pressed="${look.outfit === entry.id}" class="${look.outfit === entry.id ? 'active' : ''}">${entry.name.replace('荒野', '').replace('东方', '').replace('都市', '').replace('星际', '').replace('古城', '')}装</button>`).join('')}</div>
        <div class="palette-row"><div><div class="option-heading"><strong>03 <span>服装配色</span></strong></div><div class="swatches" role="group" aria-label="服装颜色">${OUTFIT_COLORS.map((entry) => swatch('color', entry, look.color)).join('')}</div></div><div><div class="option-heading"><strong><span>肤色</span></strong></div><div class="swatches" role="group" aria-label="肤色">${SKIN_TONES.map((entry) => swatch('skin', entry, look.skin)).join('')}</div></div></div>
      </div>
    </div>
    <div class="studio-footer"><p>外观只改变造型。挑个喜欢的样子，上场吧。</p><button class="start-button" data-action="close"><span>完成搭配</span><span>✓</span></button></div>`;
}

function swatch(field: string, entry: { name: string; value: number }, selected: number): string {
  return `<button class="swatch ${selected === entry.value ? 'active' : ''}" style="--swatch:${colorCss(entry.value)}" data-action="look-field" data-field="${field}" data-value="${entry.value}" aria-label="${entry.name}" title="${entry.name}" aria-pressed="${selected === entry.value}"><span>${selected === entry.value ? '✓' : ''}</span></button>`;
}

export function drawAppearancePreviews(root: HTMLElement, look: CharacterAppearance): void {
  const preview = root.querySelector<HTMLCanvasElement>('.character-preview')!;
  const ctx = preview.getContext('2d')!;
  ctx.clearRect(0, 0, preview.width, preview.height);
  ctx.fillStyle = '#17232c24'; ctx.beginPath(); ctx.ellipse(282, 517, 132, 20, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.translate(264, 512); ctx.scale(5.3, 5.3); paintCharacter(ctx, look); ctx.restore();
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('[data-portrait]')) {
    const preset = APPEARANCE_PRESETS.find((entry) => entry.id === canvas.dataset.portrait)!;
    const portrait = canvas.getContext('2d')!;
    portrait.save(); portrait.translate(76, 174); portrait.scale(1.85, 1.85); paintCharacter(portrait, preset.appearance); portrait.restore();
  }
}
