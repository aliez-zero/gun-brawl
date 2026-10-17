import { ARENAS } from '../../content/maps';
import { colorCss } from '../../presentation/CharacterArt';
import { paintWorld } from '../../presentation/WorldArt';
import './maps.css';

export function mapPicker(selectedId: string, nextRound: boolean): string {
  return `<div class="map-picker-note"><span>四座战场，四种气氛。每张地图都有自己的高台与退路。</span><span class="saved-note"><i></i> 自动保存${nextRound ? ' · 下局生效' : ''}</span></div>
    <div class="map-grid" role="group" aria-label="选择对战地图">${ARENAS.map((map, index) => `<button class="map-card ${map.id === selectedId ? 'active' : ''}" data-action="select-map" data-map="${map.id}" aria-pressed="${map.id === selectedId}" style="--map-accent:${colorCss(map.accent ?? 0xc4f56b)}"><div class="map-image"><canvas width="640" height="360" data-map-preview="${map.id}" aria-hidden="true"></canvas><span class="map-number">SECTOR 0${index + 1}</span><span class="map-selected">${map.id === selectedId ? '✓ 已选择' : '选择地图 ↗'}</span></div><div class="map-card-copy"><div><strong>${map.name}</strong><small>${map.subtitle}</small></div><p>${map.description}</p></div></button>`).join('')}</div>
    <div class="studio-footer"><p>背景中的建筑是远景。亮色边缘的平台都可以落脚。</p><button class="start-button" data-action="close"><span>前往这座战场</span><span>↗</span></button></div>`;
}

export function drawMapPreviews(root: HTMLElement): void {
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('[data-map-preview]')) {
    const map = ARENAS.find((entry) => entry.id === canvas.dataset.mapPreview)!;
    const ctx = canvas.getContext('2d')!;
    ctx.save(); ctx.scale(canvas.width / map.width, canvas.height / map.height); paintWorld(ctx, map); ctx.restore();
  }
}
