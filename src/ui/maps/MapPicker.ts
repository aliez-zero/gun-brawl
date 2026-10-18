import { ARENAS } from '../../content/maps';
import { colorCss } from '../../presentation/CharacterArt';
import { paintWorld } from '../../presentation/WorldArt';
import './maps.css';

export function mapPicker(selectedId: string, nextRound: boolean): string {
  return `<div class="map-picker-note"><span>双塔庭院、摩天楼顶、反应堆甲板。换张地图，换条进攻路线。</span><span class="saved-note"><i></i> 自动保存${nextRound ? ' · 下局生效' : ''}</span></div>
    <div class="map-grid" role="group" aria-label="选择对战地图">${ARENAS.map((map, index) => `<button class="map-card ${map.id === selectedId ? 'active' : ''}" data-action="select-map" data-map="${map.id}" aria-pressed="${map.id === selectedId}" style="--map-accent:${colorCss(map.accent ?? 0xc4f56b)}"><div class="map-image"><canvas width="640" height="360" data-map-preview="${map.id}" aria-hidden="true"></canvas><span class="map-number">SECTOR 0${index + 1}</span><span class="map-selected">${map.id === selectedId ? '✓ 已选择' : '选择地图 ↗'}</span></div><div class="map-card-copy"><div><strong>${map.name}</strong><small>${map.subtitle}</small></div><p>${map.description}</p></div></button>`).join('')}</div>
    <div class="studio-footer"><p>亮边可落脚，缺口下方会坠落。S / ↓ 向下穿台，留意下一处落点。</p><button class="start-button" data-action="close"><span>前往这座战场</span><span>↗</span></button></div>`;
}

export function drawMapPreviews(root: HTMLElement): void {
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('[data-map-preview]')) {
    const map = ARENAS.find((entry) => entry.id === canvas.dataset.mapPreview)!;
    const ctx = canvas.getContext('2d')!;
    ctx.save(); ctx.scale(canvas.width / map.width, canvas.height / map.height); paintWorld(ctx, map); ctx.restore();
  }
}
