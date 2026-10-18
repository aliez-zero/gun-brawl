import type { CharacterAppearance } from '../../game/core/types';
import { paintHumanoid } from '../../presentation/characters/HumanoidArt';
import { sampleHumanoid } from '../../presentation/characters/HumanoidRig';

const previews = new WeakMap<HTMLElement, () => void>();
type PreviewAction = 'idle' | 'run' | 'jump' | 'reload';

export function stopAppearancePreview(root: HTMLElement): void {
  previews.get(root)?.(); previews.delete(root);
}

/** One RAF per open studio. A mutation observer releases it immediately on close. */
export function startAppearancePreview(root: HTMLElement, look: CharacterAppearance): void {
  stopAppearancePreview(root);
  const canvas = root.querySelector<HTMLCanvasElement>('.character-preview');
  const controls = root.querySelector<HTMLElement>('.motion-preview-controls');
  if (!canvas || !controls) return;
  const ctx = canvas.getContext('2d')!;
  const small = root.querySelector<HTMLCanvasElement>('.character-game-scale')!;
  const smallCtx = small.getContext('2d')!;
  let action: PreviewAction = 'idle', facing = 1, frame = 0, time = 0, previous = 0, stopped = false;
  const listeners = new AbortController();
  controls.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    event.stopPropagation();
    if (button.dataset.previewFacing) {
      facing *= -1; button.textContent = facing < 0 ? '朝向 ←' : '朝向 →';
      button.setAttribute('aria-label', facing < 0 ? '当前朝左，切换朝向' : '当前朝右，切换朝向');
    } else {
      action = button.dataset.previewMotion as PreviewAction;
      time = 0;
      controls.querySelectorAll('[data-preview-motion]').forEach((entry) => entry.setAttribute('aria-pressed', String(entry === button)));
    }
  }, { signal: listeners.signal });
  const draw = (target: CanvasRenderingContext2D, x: number, y: number, scale: number): void => {
    const cycle = time * 1.9;
    const jumpAge = time % 1.7;
    const airborne = action === 'jump' && jumpAge < 1.15;
    const landing = action === 'jump' && jumpAge >= 1.15 && jumpAge < 1.33 ? Math.sin((jumpAge - 1.15) / 0.18 * Math.PI) : 0;
    const reload = action === 'reload' ? (time % 2.3) / 2.3 : 0;
    target.save(); target.translate(x, y); target.scale(scale * facing, scale);
    paintHumanoid(target, look, sampleHumanoid({
      outfit: look.outfit, time, cycle, run: action === 'run' ? 1 : 0,
      airborne, falling: airborne && jumpAge > 0.6,
      doubleJump: airborne && jumpAge > 0.35 && jumpAge < 0.6,
      landing, reload, hurt: 0, recoil: 0, weaponId: 'pistol',
    }));
    target.restore();
  };
  const tick = (now: number): void => {
    if (stopped) return;
    if (!canvas.isConnected || !root.contains(canvas)) { stopAppearancePreview(root); return; }
    // Hidden tabs do not advance or render the preview animation.
    if (!document.hidden) {
      time += previous ? Math.min((now - previous) / 1000, 0.05) : 0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#17232c24'; ctx.beginPath(); ctx.ellipse(282, 517, 132, 20, 0, 0, Math.PI * 2); ctx.fill();
      draw(ctx, 264, 512, 5.3);
      smallCtx.clearRect(0, 0, small.width, small.height);
      smallCtx.strokeStyle = '#53685b55'; smallCtx.beginPath(); smallCtx.moveTo(8, 94); smallCtx.lineTo(132, 94); smallCtx.stroke();
      draw(smallCtx, 64, 92, 1);
    }
    previous = now;
    frame = requestAnimationFrame(tick);
  };
  const observer = new MutationObserver(() => {
    if (!root.contains(canvas)) stopAppearancePreview(root);
  });
  observer.observe(root, { childList: true, subtree: true });
  previews.set(root, () => { stopped = true; cancelAnimationFrame(frame); listeners.abort(); observer.disconnect(); });
  tick(performance.now());
}
