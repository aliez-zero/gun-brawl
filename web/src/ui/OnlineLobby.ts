import { ARENAS } from '../content/maps';
import { SLOT_BOT, SLOT_EMPTY, type RoomView } from '../net/protocol';

/**
 * HTML for the online dialog: entry form when not in a room, room panel
 * otherwise. Actions are handled centrally in `GameUI`.
 */
export function onlineLobbyHtml(room: RoomView | null, playerId: number, status: string): string {
  if (!room) {
    const maps = ARENAS.map((map) => `<option value="${map.id}">${map.name}</option>`).join('');
    return `<p class="dialog-copy">创建房间或用房间码加入。最多 4 人，空位可设为 AI。</p>
      <label class="online-field">昵称 <input id="online-name" maxlength="16" value="玩家${playerId || ''}"></label>
      <label class="online-field">房间码 <input id="online-code" maxlength="6" placeholder="ABC234" autocomplete="off"></label>
      <div class="dialog-actions"><button data-action="online-join">加入房间</button></div>
      <hr class="online-divider">
      <label class="online-field">地图 <select id="online-map">${maps}</select></label>
      <div class="online-row">
        <label class="online-field">生命 <select id="online-stocks"><option>3</option><option>2</option><option>5</option><option>9</option></select></label>
        <label class="online-field">时长（秒） <select id="online-duration"><option>180</option><option>120</option><option>300</option><option>600</option></select></label>
      </div>
      <div class="dialog-actions"><button class="start-button" data-action="online-create"><span>创建房间</span><span>↗</span></button></div>
      <p class="dialog-copy online-status" id="online-status">${status}</p>`;
  }

  const slots = room.slots.map((slot, index) => {
    const label = slot.kind === SLOT_EMPTY
      ? '空位'
      : slot.kind === SLOT_BOT
        ? `${slot.name}（AI）`
        : `${slot.name}${slot.player === playerId ? '（你）' : ''}${slot.ready ? ' · 已准备' : ''}`;
    const bot = room.host === playerId && slot.kind === SLOT_EMPTY
      ? `<button data-action="online-bot" data-slot="${index}">设为 AI</button>`
      : '';
    return `<li><span>${index + 1}. ${label}</span>${bot}</li>`;
  }).join('');

  const me = room.slots.find((slot) => slot.player === playerId);
  const ready = me?.ready ?? false;
  const host = room.host === playerId;
  const active = room.slots.filter((slot) => slot.kind !== SLOT_EMPTY).length;
  const phaseLabel = room.phase === 0 ? '等待开始' : room.phase === 3 ? '对局结束' : '对局进行中';
  const start = host && room.phase === 0
    ? `<button data-action="online-start" ${active < 2 ? 'disabled' : ''}>开始对战</button>`
    : '';
  const rematch = host && room.phase === 3 ? '<button data-action="online-rematch">再来一局</button>' : '';

  return `<p class="dialog-copy">房间码 <b class="online-code">${room.code}</b> · ${phaseLabel}</p>
    <ul class="online-slots">${slots}</ul>
    <div class="dialog-actions">
      <button data-action="online-ready" data-ready="${ready}">${ready ? '取消准备' : '准备'}</button>
      ${start}${rematch}
      <button data-action="online-leave">离开房间</button>
    </div>
    <p class="dialog-copy online-status" id="online-status">${status}</p>`;
}
