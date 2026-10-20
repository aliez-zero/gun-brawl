import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.GAME_TEST_URL ?? 'http://127.0.0.1:5173';
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.stack); });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.locator('[data-action="start"]:not([disabled])').waitFor();
  await page.locator('.site-header [data-action="appearance"]').click();
  for (const style of ['cowboy', 'ronin', 'operative', 'astronaut', 'knight']) {
    await page.locator(`[data-action="look-preset"][data-value="${style}"]`).click();
    const idle = await page.locator('.character-preview').screenshot();
    await page.locator('[data-preview-motion="run"]').click();
    await page.waitForTimeout(180);
    assert.equal(await page.locator('[data-preview-motion="run"]').getAttribute('aria-pressed'), 'true');
    assert.equal(idle.equals(await page.locator('.character-preview').screenshot()), false);
    await page.locator('[data-preview-facing]').click();
    assert.match(await page.locator('[data-preview-facing]').textContent(), /←/);
    for (const action of ['jump', 'reload', 'idle']) {
      await page.locator(`[data-preview-motion="${action}"]`).click();
      assert.equal(await page.locator(`[data-preview-motion="${action}"]`).getAttribute('aria-pressed'), 'true');
    }
    await page.locator('[data-preview-facing]').click();
    await page.screenshot({ path: `artifacts/${style}-rig-studio.png`, fullPage: true });
  }
  await page.locator('[data-action="close"]').click();

  // An isolated Phaser scene checks actual layered images and the real WeaponLayer.
  await page.route('**/rig-runtime-check', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#131f27}#rig-scene{width:1280px;height:720px;margin:28px auto}p{color:#c9d4c9;text-align:center;font:15px sans-serif}</style><p>全角色骨架 · 双向握持与动作接线</p><div id="rig-scene"></div>' }));
  await page.goto(`${baseURL}/rig-runtime-check`);
  await page.evaluate(async () => {
    const Phaser = (await import('/node_modules/.vite/deps/phaser.js')).default;
    const { ArenaRenderer } = await import('/src/presentation/ArenaRenderer.ts');
    const { WeaponLayer } = await import('/src/presentation/WeaponLayer.ts');
    const { BattleSimulation } = await import('/src/game/core/BattleSimulation.ts');
    const { createCustomMatchConfig, DEFAULT_CUSTOM_MATCH } = await import('/src/content/matches.ts');
    const { presetAppearance } = await import('/src/content/appearances.ts');
    const { createWeapon, weaponMuzzle } = await import('/src/content/weapons.ts');
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Rig scene did not initialize within 15 seconds')), 15000);
      class RigScene extends Phaser.Scene {
        create() {
          try {
            const renderer = new ArenaRenderer(this), weapons = new WeaponLayer(this);
            const config = createCustomMatchConfig({ ...DEFAULT_CUSTOM_MATCH, slots: [{ kind: 'human', inputSlot: 1 }, { kind: 'human', inputSlot: 2 }, { kind: 'bot', difficulty: 'normal' }, { kind: 'bot', difficulty: 'normal' }] }, 123);
            const simulation = new BattleSimulation({ ...config, countdown: 0 });
            simulation.step(1 / 60, new Map()); simulation.step(1 / 60, new Map());
            const state = simulation.state;
            state.actors.forEach((actor, index) => {
              actor.config = { ...actor.config, appearance: presetAppearance('cowboy') };
              actor.position = { x: 280 + index * 240, y: 620 }; actor.previous = { ...actor.position };
              actor.groundedOn = state.config.map.platforms[0].id; actor.facing = index % 2 ? -1 : 1;
              actor.protectionRemaining = 0; actor.weapon = createWeapon(index % 2 ? 'awm' : 'pistol');
            });
            const draw = (seconds = 1 / 60) => { renderer.draw(state, 1, seconds); weapons.draw(state, 1, renderer.weaponMounts); };
            window.rigCheck = { scene: this, game: this.game, renderer, weapons, state, draw, createWeapon, weaponMuzzle, presetAppearance };
            draw(); clearTimeout(timeout); resolve();
          } catch (error) { clearTimeout(timeout); reject(error); }
        }
      }
      new Phaser.Game({ type: Phaser.WEBGL, parent: 'rig-scene', width: 1280, height: 720, backgroundColor: '#13202a', scene: RigScene, audio: { noAudio: true }, input: { keyboard: false }, banner: false });
    });
  });
  const runtime = await page.evaluate(() => {
    const { scene, renderer, weapons, state, draw, createWeapon, weaponMuzzle, presetAppearance } = window.rigCheck;
    const failures = [];
    const check = (condition, message) => { if (!condition) failures.push(message); };
    const images = () => scene.children.list.filter((entry) => entry.texture?.key.startsWith('humanoid-rig-'));
    const snapshot = () => images().map((entry) => [entry.x, entry.y, entry.rotation, entry.scaleX, entry.scaleY, entry.visible, entry.alpha, entry.vertices ? [...entry.vertices] : null]);
    const initialChildren = scene.children.length;
    for (const style of ['cowboy', 'ronin', 'operative', 'astronaut', 'knight']) {
      state.actors.forEach((actor) => { actor.config.appearance = presetAppearance(style); });
      for (const facing of [-1, 1]) for (const weaponId of ['pistol', 'awm', 'rpg7', 'gatling']) {
        state.actors.forEach((actor) => { actor.facing = facing; actor.weapon = createWeapon(weaponId); actor.reloadRemaining = 0.6; });
        const before = JSON.stringify(state);
        draw();
        check(JSON.stringify(state) === before, 'renderer modified combat state');
        const meshes = images().filter((entry) => entry.type === 'Rope');
        check(meshes.length === (style === 'cowboy' ? 32 : 0), `incorrect weighted limb count for ${style}`);
        for (const mesh of meshes) {
          check([...mesh.vertices].every(Number.isFinite), 'invalid mesh vertices');
          check(mesh.vertices.length === 32 && !mesh.dirty, 'weighted mesh was regenerated by rope geometry');
          check([...mesh.uv].every((v, index) => Number.isFinite(v) && v >= (index % 2 ? mesh.frame.v0 : mesh.frame.u0) && v <= (index % 2 ? mesh.frame.v1 : mesh.frame.u1)), 'mesh sampled outside its atlas slot');
        }
        for (const actor of state.actors) {
          const mount = renderer.weaponMounts.get(actor.config.id), sprite = weapons.sprites.get(actor.config.id);
          check(mount && sprite && Math.hypot(mount.x - sprite.x, mount.y - sprite.y) < 0.001, `detached weapon ${weaponId}/${facing}`);
          const hand = images().find((entry) => Number(entry.frame.name) === 17 && Math.hypot(entry.x - mount.x, entry.y - mount.y) < 0.01);
          check(Boolean(hand), `detached trigger hand ${weaponId}/${facing}`);
        }
        check(weapons.arms.size === 0 && weapons.hands.size === 0, `duplicate legacy arms created for ${style}`);
        const actor = state.actors[0], muzzle = weaponMuzzle(weaponId);
        renderer.handle([{ type: 'shot', actorId: actor.config.id, weaponId, position: { x: actor.position.x + muzzle.x * facing, y: actor.position.y + muzzle.y } }]);
        draw(0);
        const flash = renderer.effects.at(-1), sprite = weapons.sprites.get(actor.config.id);
        const dx = (muzzle.x - 22) * facing, dy = muzzle.y + 32;
        const expected = { x: sprite.x + dx * Math.cos(sprite.rotation) - dy * Math.sin(sprite.rotation), y: sprite.y + dx * Math.sin(sprite.rotation) + dy * Math.cos(sprite.rotation) };
        check(Math.hypot(flash.x - expected.x, flash.y - expected.y) < 0.001, `flash detached from held barrel ${weaponId}/${facing}`);
        actor.position.x += 50; actor.previous.x += 50;
        draw(0);
        check(Math.hypot(flash.x - expected.x, flash.y - expected.y) < 0.001, `old flash followed moving actor ${weaponId}/${facing}`);
        actor.position.x -= 50; actor.previous.x -= 50;
      }
    }
    renderer.reset(); weapons.reset();
    state.actors.forEach((actor) => { actor.config.appearance = presetAppearance('cowboy'); actor.moveVelocity = 300; actor.reloadRemaining = 0; });
    for (let i = 0; i < 10; i++) draw();
    state.phase = 'paused'; const frozen = JSON.stringify(snapshot());
    for (let i = 0; i < 10; i++) draw(0.1);
    check(JSON.stringify(snapshot()) === frozen, 'pose drifted while paused');
    state.phase = 'playing'; draw(0.1);
    check(JSON.stringify(snapshot()) !== frozen, 'pose did not resume');
    state.actors.forEach((actor) => { actor.status = 'respawning'; }); draw();
    check(images().every((entry) => !entry.visible), 'limbs remain visible during respawn');
    check([...weapons.sprites.values()].every((entry) => !entry.visible), 'weapon remains during respawn');
    state.actors.forEach((actor) => { actor.status = 'alive'; actor.moveVelocity = 0; });
    renderer.handle(state.actors.map((actor) => ({ type: 'respawn', actorId: actor.config.id, position: actor.position }))); draw();
    check(images().filter((entry) => entry.visible).length === 72, 'respawn did not restore all four rigs');
    let largestCache = 0;
    const styles = ['cowboy', 'ronin', 'operative', 'astronaut', 'knight'];
    for (let round = 0; round < 30; round++) {
      renderer.reset(); weapons.reset();
      state.actors.forEach((actor) => {
        actor.config.appearance = { ...presetAppearance(styles[round % 5]), outfit: styles[Math.floor(round / 6)], hat: ['cowboy', 'none', 'straw', 'beret', 'space', 'knight'][round % 6], color: [0xb8663d, 0x4e8d91, 0x6464a8, 0xc9a34f][round % 4] };
      });
      draw(); largestCache = Math.max(largestCache, renderer.appearanceKeys.size);
      check(scene.children.length === initialChildren, `scene children leaked after restart ${round}`);
      check(renderer.appearanceKeys.size <= 8, `unbounded character textures ${round}`);
    }
    renderer.reset(); weapons.reset();
    state.actors.forEach((actor, index) => { actor.config.appearance = presetAppearance(styles[index + 1]); actor.facing = index % 2 ? -1 : 1; actor.weapon = createWeapon(index % 2 ? 'awm' : 'pistol'); });
    draw();
    window.rigCheck.showCowboy = () => {
      renderer.reset(); weapons.reset();
      state.actors.forEach((actor, index) => { actor.config.appearance = presetAppearance('cowboy'); actor.moveVelocity = index < 2 ? 0 : 260; });
      for (let i = 0; i < 12; i++) draw();
      scene.cameras.main.setZoom(2.2).centerOn(400, 580);
    };
    window.rigCheck.verifyDestroy = () => {
      renderer.destroy(); weapons.destroy();
      return { children: scene.children.length, atlases: scene.textures.getTextureKeys().filter((key) => key.startsWith('humanoid-rig-')).length };
    };
    return { failures, initialChildren, largestCache, restarts: 30 };
  });
  assert.deepEqual(runtime.failures, []);
  await page.waitForTimeout(80);
  await page.screenshot({ path: 'artifacts/characters-rig-battle.png', fullPage: true });
  await page.evaluate(() => window.rigCheck.showCowboy());
  await page.waitForTimeout(80);
  await page.screenshot({ path: 'artifacts/cowboy-weighted-webgl.png', fullPage: true });
  const destroyed = await page.evaluate(() => window.rigCheck.verifyDestroy());
  assert.deepEqual(destroyed, { children: 0, atlases: 0 });
  await page.evaluate(() => window.rigCheck.game.destroy(true));

  // A separate page counts scheduled preview callbacks, including replaced editors.
  await page.route('**/rig-preview-cleanup', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><div id="preview-root"></div>' }));
  await page.goto(`${baseURL}/rig-preview-cleanup`);
  const cleanup = await page.evaluate(async () => {
    const editorURL = '/src/ui/appearance/AppearanceEditor.ts';
    const { appearanceEditor, drawAppearancePreviews } = await import(editorURL);
    // Reuse the editor's exact dependency URL: Vite adds HMR timestamps, and an
    // unversioned import would create a second module with a different WeakMap.
    const editorSource = await (await fetch(editorURL)).text();
    const motionURL = editorSource.match(/from\s+["']([^"']*AppearanceMotionPreview\.ts[^"']*)["']/)?.[1];
    if (!motionURL) throw new Error('Could not resolve the editor preview dependency');
    const { stopAppearancePreview } = await import(new URL(motionURL, location.origin).href);
    const { presetAppearance } = await import('/src/content/appearances.ts');
    const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window), scheduled = new Set();
    window.requestAnimationFrame = (callback) => {
      const id = raf((now) => { scheduled.delete(id); callback(now); }); scheduled.add(id); return id;
    };
    window.cancelAnimationFrame = (id) => { scheduled.delete(id); cancel(id); };
    const root = document.querySelector('#preview-root'), look = presetAppearance('cowboy');
    for (let i = 0; i < 20; i++) { const current = presetAppearance(['cowboy', 'ronin', 'operative', 'astronaut', 'knight'][i % 5]); root.innerHTML = appearanceEditor(1, current, false); drawAppearancePreviews(root, current); }
    const afterRefresh = scheduled.size;
    root.replaceChildren();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterClose = scheduled.size;
    root.innerHTML = appearanceEditor(1, look, false); drawAppearancePreviews(root, look); stopAppearancePreview(root);
    return { afterRefresh, afterClose, afterDestroy: scheduled.size };
  });
  assert.deepEqual(cleanup, { afterRefresh: 1, afterClose: 0, afterDestroy: 0 });
  assert.deepEqual(errors, []);
  console.log(`Five humanoid rigs passed: four actors, bidirectional pistol/AWM/RPG/gatling grips and muzzle flashes, paused pose, respawn, ${runtime.restarts} mixed restarts, ${runtime.initialChildren} stable scene objects, <=${runtime.largestCache} atlases, all-style preview cleanup. Screenshots: artifacts/*-rig-studio.png, artifacts/characters-rig-battle.png`);
} finally { await browser.close(); }
