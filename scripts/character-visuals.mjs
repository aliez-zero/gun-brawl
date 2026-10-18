import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.GAME_TEST_URL ?? 'http://127.0.0.1:5173';
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  // Same origin as Vite, with no game loop: inspect actual drawing modules directly.
  await page.route('**/character-visual-check', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body></body>' }));
  await page.goto(`${baseURL}/character-visual-check`);
  const results = await page.evaluate(async () => {
    const { paintCharacter, createCharacterAtlas, CHARACTER_FRAME } = await import('/src/presentation/CharacterArt.ts');
    const { APPEARANCE_PRESETS, HEADWEAR } = await import('/src/content/appearances.ts');
    const { CHARACTER_ANIMATION, characterPoseForFrame } = await import('/src/presentation/CharacterMotion.ts');
    const hash = (data) => { let h=2166136261; for (const value of data) h=Math.imul(h ^ value,16777619); return h>>>0; };
    const errors = [], faces = [], atlases = [];
    let checkedFrames=0, mixes=0;
    const inspect = (canvas, label) => {
      const { width:w, height:h } = canvas;
      const data=canvas.getContext('2d').getImageData(0,0,w,h).data;
      let occupied=0;
      for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
        if (!data[(y*w+x)*4+3]) continue;
        occupied++;
        if (x<2 || y<2 || x>=w-2 || y>=h-2) { errors.push(`${label}: clipped border at ${x},${y}`); return; }
      }
      if (occupied<200) errors.push(`${label}: empty drawing`);
    };
    const frameCanvas=document.createElement('canvas'); frameCanvas.width=CHARACTER_FRAME.width; frameCanvas.height=CHARACTER_FRAME.height;
    const frameContext=frameCanvas.getContext('2d');
    for (const preset of APPEARANCE_PRESETS) {
      const atlas=createCharacterAtlas(preset.appearance); atlases.push(atlas);
      if (atlas.width>4096 || atlas.height>4096) errors.push(`${preset.id}: oversized atlas`);
      for (let f=0;f<CHARACTER_ANIMATION.frames;f++) {
        frameContext.clearRect(0,0,frameCanvas.width,frameCanvas.height);
        frameContext.drawImage(atlas,f%CHARACTER_ANIMATION.columns*CHARACTER_FRAME.width,Math.floor(f/CHARACTER_ANIMATION.columns)*CHARACTER_FRAME.height,CHARACTER_FRAME.width,CHARACTER_FRAME.height,0,0,CHARACTER_FRAME.width,CHARACTER_FRAME.height);
        inspect(frameCanvas,`${preset.id} frame ${f}`); checkedFrames++;
      }
      for (const hat of HEADWEAR) for (const outfit of APPEARANCE_PRESETS) {
        frameContext.clearRect(0,0,frameCanvas.width,frameCanvas.height);
        frameContext.save(); frameContext.translate(120,264); frameContext.scale(3,3);
        paintCharacter(frameContext,{...preset.appearance,hat:hat.id,outfit:outfit.id},{},false); frameContext.restore();
        inspect(frameCanvas,`${preset.id}/${hat.id}/${outfit.id}`); mixes++;
      }
      frameContext.clearRect(0,0,frameCanvas.width,frameCanvas.height);
      frameContext.save(); frameContext.translate(120,264); frameContext.scale(3,3);
      paintCharacter(frameContext,{...preset.appearance,hat:'none',outfit:'cowboy',color:0xb8663d,skin:0xe7b58e},{},false); frameContext.restore();
      faces.push(hash(frameContext.getImageData(78,38,94,92).data));
    }
    document.head.insertAdjacentHTML('beforeend', `<style>*{box-sizing:border-box}body{margin:0;background:#101b22;color:#e8ecdf;font:14px "Microsoft YaHei",sans-serif}main{padding:28px}header{display:flex;justify-content:space-between;border-bottom:1px solid #43535b;padding-bottom:20px;margin-bottom:20px}.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}article{background:#24353e;border:1px solid #43535b;padding:16px}h2{font-size:20px;margin:0 0 10px}small{font-size:10px;color:#aec1bd;display:block;height:23px}canvas{display:block;width:100%}.poses{margin-top:15px;padding-top:15px;border-top:1px solid #43535b}.caption{font-size:11px;color:#a6b9b8;margin:10px 0}.film{display:none;grid-template-columns:repeat(11,1fr);gap:4px}.film canvas{background:#24353e}.film label{display:block;font-size:10px;color:#aec1bd;text-align:center;margin-top:5px}</style>`);
    document.body.innerHTML='<main><header><b>GUN BRAWL / CHARACTER STUDY</b><span>五位角色 · 第一轮造型与动作精修</span></header><div class="cards"></div><div class="film"></div></main>';
    for (let index=0;index<APPEARANCE_PRESETS.length;index++) {
      const preset=APPEARANCE_PRESETS[index];
      const card=document.createElement('article');
      card.innerHTML=`<h2>${preset.name}</h2><small>${preset.english}</small><canvas class="hero" width="540" height="610"></canvas><div class="caption">实战尺寸 · 站立 / 跑动 / 跳跃</div><canvas class="poses" width="540" height="230"></canvas><div class="caption">黑色剪影 · 检查轮廓识别</div><canvas class="silhouette" width="540" height="230"></canvas>`;
      document.querySelector('.cards').append(card);
      const hero=card.querySelector('.hero').getContext('2d'); hero.translate(250,560); hero.scale(5.8,5.8); paintCharacter(hero,preset.appearance);
      for (const name of ['poses','silhouette']) {
        const ctx=card.querySelector(`.${name}`).getContext('2d');
        for (let i=0;i<3;i++) { ctx.save();ctx.translate(90+i*175,206);ctx.scale(2,2);paintCharacter(ctx,preset.appearance,i===1?characterPoseForFrame(6):i===2?characterPoseForFrame(12):{},false);ctx.restore(); }
        if (name==='silhouette') { ctx.globalCompositeOperation='source-in';ctx.fillStyle='#070c12';ctx.fillRect(0,0,540,230); }
      }
      for (let f=0;f<CHARACTER_ANIMATION.frames;f++) {
        const cell=document.createElement('div'); const canvas=document.createElement('canvas');canvas.width=160;canvas.height=192;
        canvas.getContext('2d').drawImage(atlases[index],f%8*240,Math.floor(f/8)*288,240,288,0,0,160,192);
        cell.append(canvas);const label=document.createElement('label');label.textContent=`${preset.name} / ${f}`;cell.append(label);document.querySelector('.film').append(cell);
      }
    }
    return {errors,checkedFrames,mixes,distinctFaces:new Set(faces).size};
  });
  assert.deepEqual(results.errors, []);
  assert.equal(results.checkedFrames, 110);
  assert.equal(results.mixes, 150);
  assert.equal(results.distinctFaces, 5, 'style must change the face even with identical skin, hat and outfit');
  await page.screenshot({ path:'artifacts/characters-lineup.png',fullPage:true });
  await page.evaluate(() => { document.querySelector('.cards').style.display='none';document.querySelector('.film').style.display='grid'; });
  await page.screenshot({ path:'artifacts/characters-poses.png',fullPage:true });
  console.log(`Character visuals passed: ${results.checkedFrames} atlas frames, ${results.mixes} mixed outfits, five distinct faces, no clipped frame edges.`);
} finally { await browser.close(); }
