import type { DeepSeekInfo } from '../adapters/ai/DeepSeekClient';
const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function deepSeekSetup(info: DeepSeekInfo | null, map: string, error: string | null, starting: boolean): string {
  const ready = Boolean(info?.configured) && !error;
  return `<p class="dialog-copy">你和 DeepSeek 同场对决。它读取战场状态，直接决定移动、跳跃和开火，遵守与你相同的规则。</p>
    <div class="deepseek-connection ${ready ? 'ready' : ''}" role="status">
      <strong>${starting ? '正在连接对局…' : error ? escape(error) : !info ? '正在检查配置…' : ready ? 'DeepSeek 已配置' : '尚未配置 DeepSeek 密钥'}</strong>
      ${info ? `<span>模型 ${escape(info.model)} · 每局最多 ${info.maxRequests} 次决策</span>` : ''}
    </div>
    ${info ? `<p class="dialog-copy"><span>单次请求上下文上限 ${Number((info.contextTokens / 1000).toFixed(3))}K token</span><span> · ${info.thinking === 'disabled' ? '快速模式' : `思考模式 ${escape(info.reasoningEffort ?? 'low')}`}</span></p>` : ''}
    <p class="dialog-copy">地图：${escape(map)} · 每人 3 条命 · 3 分钟<br>操作有响应延迟；等待模型回复时由本地实时战术层保持移动、瞄准和回台。</p>
    ${info && !info.configured ? '<p class="deepseek-config">首次使用：复制项目的 <code>.env.example</code> 为 <code>.env.local</code>，填入 <code>DEEPSEEK_API_KEY</code>，重启游戏服务后重新检查。密钥保留在本机服务端。</p>' : ''}
    <button class="start-button" data-action="start-deepseek" ${ready && !starting ? '' : 'disabled'}><span>${starting ? '正在连接' : '挑战 DeepSeek'}</span><span>↗</span></button>
    <div class="dialog-actions"><button data-action="deepseek" ${starting ? 'disabled' : ''}>重新检查</button><button data-action="close">返回</button></div>`;
}
