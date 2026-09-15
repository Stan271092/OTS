// One temporary Edge instance. Reduced motion keeps the embedded scene static for layout checks.
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const base = process.env.OTS_URL || 'http://127.0.0.1:8767/';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ots-site-'));
const checks = path.join(__dirname, 'checks');
fs.mkdirSync(checks, {recursive:true});
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking',
  '--renderer-process-limit=1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
], {stdio:'ignore'});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws, id = 0;
const calls = new Map(), errors = [], external = [];
const watchdog = setTimeout(() => {browser.kill(); process.exit(1);}, 180000);
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => {calls.delete(n); reject(Error(`${method} timed out`));}, 20000);
    calls.set(n, {resolve, reject, timer});
    ws.send(JSON.stringify({id:n, method, params}));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function screenshot(name) {
  // Let composited glass layers repaint after programmatic scrolling/resizing.
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await delay(150);
  const result = await send('Page.captureScreenshot', {format:'png', captureBeyondViewport:false});
  fs.writeFileSync(path.join(checks, `${name}.png`), Buffer.from(result.data, 'base64'));
}
async function click(selector) {
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', {type:'mousePressed', ...point, button:'left', clickCount:1});
  await send('Input.dispatchMouseEvent', {type:'mouseReleased', ...point, button:'left', clickCount:1});
}
async function reached(selector) {
  let top;
  for (let i = 0; i < 40; i++) {
    top = await evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top`);
    if (Math.abs(top) < 3) return;
    await delay(100);
  }
  assert.fail(`Navigation to ${selector} stopped ${top}px from target`);
}
async function viewport(width, height = 900) {
  await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor:1, mobile:false});
  await evaluate('window.scrollTo({top:0,behavior:"instant"})');
  await delay(80);
}
(async () => {
  let port;
  for (let i = 0; i < 150; i++) {
    const file = path.join(profile, 'DevToolsActivePort');
    if (fs.existsSync(file)) {port = fs.readFileSync(file, 'utf8').split('\n')[0]; break;}
    await delay(100);
  }
  assert.ok(port, 'Edge did not start');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, {once:true});
    ws.addEventListener('error', reject, {once:true});
  });
  ws.addEventListener('message', event => {
    const value = JSON.parse(event.data), call = calls.get(value.id);
    if (call) {
      clearTimeout(call.timer); calls.delete(value.id);
      value.error ? call.reject(Error(JSON.stringify(value.error))) : call.resolve(value.result);
    }
    if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.text);
    if (value.method === 'Log.entryAdded' && value.params.entry.level === 'error') errors.push(value.params.entry.text);
    if (value.method === 'Network.requestWillBeSent') {
      const url = value.params.request.url;
      if (!url.startsWith(base) && !url.startsWith('data:')) external.push(url);
      if (url.endsWith('/reference.png')) errors.push('Standalone reference should not load inside hero');
    }
  });
  for (const domain of ['Page','Runtime','Log','Network']) await send(`${domain}.enable`);
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__draws=0;for(const T of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){if(!T)continue;for(const n of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){const f=T.prototype[n];if(!f)continue;T.prototype[n]=function(...a){window.__draws++;return f.apply(this,a)}}}`});
  await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await viewport(1440);
  await send('Page.navigate', {url:base});
  for (let i = 0; i < 100; i++) {
    if (await evaluate('document.readyState === "complete" && !!document.querySelector("#hero-heading")')) break;
    await delay(100);
  }
  await evaluate('document.fonts.ready.then(()=>true)');
  assert.ok(await evaluate('Array.from(document.images).filter(i=>!i.loading||i.loading!=="lazy").every(i=>i.complete&&i.naturalWidth>0)'), 'Hero image missing');
  assert.equal(await evaluate('document.querySelector("#hero-heading").textContent'), 'Материал под задачу. Решение под технологию.');
  assert.ok(await evaluate('document.querySelector(".brand-logo").complete && document.querySelector(".brand-logo").naturalWidth > 0'), 'Supplied logo missing');
  let modelReady = false;
  for (let i=0; i<150; i++) {
    modelReady = await evaluate('(()=>{const f=document.querySelector("#resin-frame"),d=f?.contentDocument;return !!d?.querySelector("#scene") && d.querySelector("#loading")?.hidden===true && f.contentWindow.getComputedStyle(d.querySelector("#loading")).display==="none"})()');
    if(modelReady)break;
    await delay(200);
  }
  assert.ok(modelReady, 'Embedded model not ready: '+errors.join('; '));
  await screenshot('site-before-or-desktop');
  // Missing/overlapping companion card or a broken desktop grid loses the reference hierarchy.
  assert.ok(await evaluate(`(()=>{
    const card=document.querySelector('.hero-note');
    if(!card)return false;
    const a=document.querySelector('.hero-copy').getBoundingClientRect(),
      b=card.getBoundingClientRect(),c=document.querySelector('.hero-art').getBoundingClientRect();
    return b.top>=a.bottom && Math.abs(a.left-b.left)<2 && c.left>=a.right && c.bottom>=b.bottom-2;
  })()`), 'Desktop must have two non-overlapping left cards beside a full-height material card');
  for (const width of [1440, 1280, 1024, 820, 701, 700, 390, 320]) {
    await viewport(width, width < 701 ? 900 : 960);
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), `${width}px horizontal overflow`);
    if (process.env.OTS_DEBUG) console.log(width, await evaluate(`['.hero-copy','.hero-note','.hero-art','#hero-heading','.hero-actions','.hero-material-caption'].map(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return {selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:e.scrollWidth,client:e.clientWidth}})`));
    assert.ok(await evaluate(`(()=>{
      for(const selector of ['.hero-copy','.hero-note','.hero-art','#hero-heading','.hero-actions','.hero-material-caption']){
        const el=document.querySelector(selector),r=el.getBoundingClientRect();
        // The illustration intentionally bleeds inside its clipped card; text must not clip.
        if(r.left < -1 || r.right > innerWidth+1 || (selector!=='.hero-art' && el.scrollWidth>el.clientWidth+1))return false;
      }
      const r=document.querySelector('#hero-heading').getBoundingClientRect(),p=document.querySelector('.hero-description').getBoundingClientRect();
      return r.bottom<=p.top+1;
    })()`), `${width}px hero content clips or overlaps`);
    assert.ok(await evaluate(`(()=>{const links=[...document.querySelectorAll('.site-header a,.site-header button')].filter(e=>e.getBoundingClientRect().width);return links.every((el,i)=>{const a=el.getBoundingClientRect();return a.left>=0&&a.right<=innerWidth&&links.slice(i+1).every(other=>{const b=other.getBoundingClientRect();return a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1})})})()`), `${width}px header links overlap`);
    if (width >= 820) {
      assert.ok(await evaluate(`document.querySelector('.hero-note').getBoundingClientRect().bottom <= 960`), 'Bento cards do not fit desktop first screen');
    } else if (width <= 700) {
      assert.equal(await evaluate('getComputedStyle(document.querySelector("#site-nav")).display'), 'none');
      await click('#menu-toggle');
      assert.equal(await evaluate('document.querySelector("#menu-toggle").getAttribute("aria-expanded")'), 'true');
      await click('#site-nav a[href="#expertise"]');
      await reached('#expertise');
      assert.equal(await evaluate('document.querySelector("#menu-toggle").getAttribute("aria-expanded")'), 'false');
      await evaluate('window.scrollTo({top:0,behavior:"instant"})');
    }
    assert.ok(await evaluate(`(()=>{
      for(const selector of ['.section-intro h2','.section-description','.service-card','.process-steps li','.contact-copy','.contact-form-card','.footer','.application-copy']) {
        for(const e of document.querySelectorAll(selector)) {
          const r=e.getBoundingClientRect();
          if(r.left<-1||r.right>innerWidth+1)return false;
          // Decorative stars intentionally bleed into clipped card edges; actual text must fit.
          const textNodes=e.matches('h2,p')?[e]:e.querySelectorAll('h2,h3,p,input,select,textarea');
          for(const text of textNodes)if(text.scrollWidth>text.clientWidth+1)return false;
        }
      }
      return true;
    })()`), `${width}px lower section content clipped`);
    if ([1440,820,390,320].includes(width)) {
      await screenshot(`site-${width}`);
      for(const section of ['expertise','applications','approach','contact']) {
        await evaluate(`document.querySelector('#${section}').scrollIntoView({behavior:'instant',block:'start'})`);
        if(section==='applications') await evaluate('document.querySelector("#application-image").decode().then(()=>true)');
        await screenshot(`site-${width}-${section}`);
      }
      await evaluate('window.scrollTo({top:0,behavior:"instant"})');
    }
  }
  await viewport(1280);
  await click('.hero-note');
  await reached('#applications');
  for (const sector of ['construction','industry','sport','electronics']) {
    await evaluate(`document.querySelector('[data-sector=${sector}]').click()`);
    await evaluate('document.querySelector("#application-image").decode().then(()=>true)');
    assert.ok(await evaluate(`document.querySelector('#application-image').src.endsWith('${sector}-light.jpg')`), 'Wrong sector image');
    await screenshot(`sector-${sector}`);
  }
  await evaluate('document.querySelector("[data-sector=electronics]").click()');
  assert.equal(await evaluate('document.querySelector("#application-title").textContent'), 'Электроника');
  await evaluate('document.querySelector("#application-cta").click()');
  assert.equal(await evaluate('document.querySelector("#topic").value'), 'Система для электроники');
  await evaluate('document.querySelector("#contact-form").requestSubmit()');
  assert.equal(await evaluate('document.querySelector("#name-error").textContent'), 'Заполните имя');
  await evaluate('document.querySelector("#name").value="Тест";document.querySelector("#email").value="test@example.com";document.querySelector("#contact-form").requestSubmit()');
  assert.ok(await evaluate('document.querySelector("#form-status").textContent.includes("Ничего не отправлено")'));
  await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.hero-bento *, .site-header *')).every(e=>getComputedStyle(e).animationName==='none')`), 'Decorative autoplay on reduced motion');
  await evaluate('document.querySelector(".hero-actions a").focus()');
  assert.ok(await evaluate('parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2'), 'CTA keyboard focus invisible');
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 1, 'Exactly one embedded 3D scene required');
  assert.ok(await evaluate('document.querySelector("#resin-frame").contentDocument.querySelector("#scene").width>0'), 'Live canvas has no backing pixels');
  // Verify the real embedded canvas, not a top-level surrogate.
  await viewport(1280);
  const drawCount=()=>evaluate('document.querySelector("#resin-frame").contentWindow.__draws');
  const childEval=expr=>evaluate(`document.querySelector('#resin-frame').contentWindow.eval(${JSON.stringify(expr)})`);
  async function stableModel(label) {
    await delay(300);const count=await drawCount();await delay(500);
    assert.equal(await drawCount(),count,label);
  }
  await stableModel('Reduced-motion iframe keeps rendering');
  const clip=await evaluate(`(()=>{const r=document.querySelector('#resin-frame').getBoundingClientRect();return {x:r.x+24,y:r.y+60,width:r.width-48,height:r.height-120,scale:1}})()`);
  const canvasShot=async name=>{
    const shot=await send('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:false});
    if(name)fs.writeFileSync(path.join(checks,name+'.png'),Buffer.from(shot.data,'base64'));
    return shot.data;
  };
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await delay(600);
  const motionA=await canvasShot('embedded-motion-start');await delay(1800);
  const motionB=await canvasShot('embedded-motion-later');
  assert.notEqual(motionA,motionB,'Embedded canvas pixels do not move');
  await childEval('document.querySelector("#pause").click()');
  await stableModel('Manual pause must stop GPU rendering');
  const pausedA=await canvasShot();await delay(500);
  assert.equal(await canvasShot(),pausedA,'Paused model changes visible pixels');
  await evaluate('document.querySelector("#contact").scrollIntoView({behavior:"instant"})');
  await stableModel('Offscreen paused iframe must stop');
  await evaluate('window.scrollTo({top:0,behavior:"instant"})');
  await stableModel('Scrolling back must retain manual pause');
  assert.equal(await childEval('document.querySelector("#pause").getAttribute("aria-pressed")'),'true');
  await childEval('document.querySelector("#pause").click()');await delay(300);
  const resumed=await drawCount();await delay(500);assert.ok(await drawCount()>resumed,'Visible iframe did not resume');
  await evaluate('document.querySelector("#contact").scrollIntoView({behavior:"instant"})');
  await stableModel('Playing iframe must stop when offscreen');
  await evaluate('window.scrollTo({top:0,behavior:"instant"})');await delay(300);
  const returned=await drawCount();await delay(500);assert.ok(await drawCount()>returned,'Offscreen iframe did not resume');
  for(const prop of ['visibility','display']) {
    await evaluate(`document.querySelector('.hero-art').style.${prop}=${JSON.stringify(prop==='visibility'?'hidden':'none')}`);
    await stableModel('Hidden ancestor must stop iframe rendering');
    await evaluate(`document.querySelector('.hero-art').style.${prop}=''`);await delay(350);
    const count=await drawCount();await delay(500);assert.ok(await drawCount()>count,'Visible ancestor did not resume iframe');
  }
  // A same-origin child sending to itself is not its host; reject it.
  await childEval('window.postMessage({type:"ots-resin-visibility",visible:false},location.origin)');
  const beforeUntrusted=await drawCount();await delay(500);
  assert.ok(await drawCount()>beforeUntrusted,'Non-parent message incorrectly paused scene');
  await evaluate(`document.querySelector('#resin-frame').contentWindow.postMessage({type:'ots-resin-visibility',visible:'false'},location.origin)`);
  const beforeMalformed=await drawCount();await delay(500);
  assert.ok(await drawCount()>beforeMalformed,'Malformed host message incorrectly paused scene');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await stableModel('Reduced motion must stop active animation');
  console.log('PASS: real iframe pixel motion; manual, offscreen, ancestor CSS and reduced-motion pause; source and payload validation.');
  assert.deepEqual(external, [], 'External network requests');
  assert.deepEqual(errors, [], 'Browser/HTTP errors');
  console.log('PASS: 8 widths, logo/headline, hero and lower sections, menu, anchors, 4 new photos, demo form, focus, reduced motion, real embedded model, no external requests.');
})().catch(error => {console.error(error); process.exitCode=1;}).finally(async () => {
  clearTimeout(watchdog);
  if (ws) {try {await send('Browser.close');} catch {} ws.close();}
  browser.kill();
  await delay(500);
  try {fs.rmSync(profile, {recursive:true, force:true});} catch {}
});
