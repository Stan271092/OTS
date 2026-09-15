// One temporary Edge instance; local requests only; no software-GPU override.
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const origin='http://127.0.0.1:8768';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ots-webgl-v4-'));
const checks=path.join(__dirname,'checks');
fs.mkdirSync(checks,{recursive:true});
const server=spawn('python',[path.join(root,'serve.py'),'--port','8768'],{cwd:root,stdio:'ignore'});
const browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
  '--headless=new','--no-first-run','--disable-extensions','--disable-background-networking',
  '--disable-component-update','--no-default-browser-check','--renderer-process-limit=1',
  '--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'
],{stdio:'ignore'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let ws,id=0,closing=false;
const calls=new Map(),errors=[],external=[];
for(const child of [server,browser])child.on('error',error=>errors.push(error.message));
function killChildren(){
  for(const child of [browser,server]){
    if(!child.pid||child.exitCode!==null)continue;
    if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:5000});
    else child.kill('SIGKILL');
  }
}
const watchdog=setTimeout(()=>{
  console.error('WEBGL v4 watchdog expired; closing temporary processes.');
  killChildren();process.exit(1);
},120000);
process.once('SIGINT',()=>{killChildren();process.exit(130)});
process.once('SIGTERM',()=>{killChildren();process.exit(143)});
async function send(method,params={}){
  const n=++id;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{calls.delete(n);reject(Error(`${method} timed out after 20 seconds`))},20000);
    calls.set(n,{resolve,reject,timer});
    try{ws.send(JSON.stringify({id:n,method,params}));}
    catch(error){clearTimeout(timer);calls.delete(n);reject(error);}
  });
}
async function evaluate(expression){
  const value=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  assert.ok(!value.exceptionDetails,JSON.stringify(value.exceptionDetails));
  return value.result.value;
}
async function shot(name,clip){
  const value=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,...(clip?{clip}:{})});
  if(name)fs.writeFileSync(path.join(checks,name+'.png'),Buffer.from(value.data,'base64'));
  return value.data;
}
async function canvasClip(close=false){
  return evaluate(`(()=>{const r=document.querySelector('#scene').getBoundingClientRect();
    const inset=${close?'.2':'.03'};
    return {x:r.x+scrollX+r.width*inset,y:r.y+scrollY+r.height*inset,
      width:r.width*(1-2*inset),height:r.height*(1-2*inset),scale:1};})()`);
}
async function stable(label){
  await delay(300);
  const count=await evaluate('window.__draws');
  await delay(450);
  assert.equal(await evaluate('window.__draws'),count,label+': GPU keeps submitting draws');
}
async function click(selector){
  await evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});
    if(!button||button.disabled)throw Error('Missing or disabled control: '+${JSON.stringify(selector)});
    button.click();})()`);
}
async function selected(selector){
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-pressed')`),'true',selector+' is not selected');
}
async function key(name){
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name});
}
(async()=>{
  let port;
  for(let i=0;i<100;i++){
    const file=path.join(profile,'DevToolsActivePort');
    if(fs.existsSync(file)){port=fs.readFileSync(file,'utf8').split('\n')[0];break;}
    await delay(100);
  }
  assert.ok(port,'Temporary Edge unavailable: '+errors.join('; '));
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(20000)})).json();
  const target=targets.find(item=>item.type==='page');
  assert.ok(target,'Temporary Edge page unavailable');
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('CDP connection timed out')),20000);
    ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
    ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP connection failed'))},{once:true});
  });
  ws.addEventListener('message',event=>{
    const value=JSON.parse(event.data),call=calls.get(value.id);
    if(call){clearTimeout(call.timer);calls.delete(value.id);value.error?call.reject(Error(JSON.stringify(value.error))):call.resolve(value.result);}
    if(value.method==='Runtime.exceptionThrown')errors.push(JSON.stringify(value.params.exceptionDetails));
    if(value.method==='Runtime.consoleAPICalled'&&value.params.type==='error')errors.push(value.params.args.map(a=>a.value||a.description).join(' '));
    if(value.method==='Log.entryAdded'&&value.params.entry.level==='error')errors.push(value.params.entry.text);
    if(value.method==='Fetch.requestPaused'){
      const {requestId,request}=value.params;
      const allowed=request.url.startsWith(origin+'/')||request.url.startsWith('data:')||request.url.startsWith('blob:'+origin+'/');
      if(!allowed)external.push(request.url);
      const fixture=request.url===origin+'/webgl/v4/scene.mjs';
      const params=fixture?{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],
        body:Buffer.from(fs.readFileSync(path.join(__dirname,'scene.mjs'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'overlap-fixture.js'),'utf8')).toString('base64')}:allowed?{requestId}:{requestId,errorReason:'BlockedByClient'};
      send(fixture?'Fetch.fulfillRequest':allowed?'Fetch.continueRequest':'Fetch.failRequest',params)
        .catch(error=>{if(!closing)errors.push(error.message)});
    }
    if(value.method==='Network.responseReceived'&&value.params.response.status>=400)
      errors.push(`HTTP ${value.params.response.status}: ${value.params.response.url}`);
  });
  for(const domain of ['Page','Runtime','Log','Network'])await send(domain+'.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  // Forward every real WebGL call unchanged. Count submissions, not guessed frames.
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__draws=0;window.__bufferUploads=0;
    for(const type of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){
      if(!type)continue;
      for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced','drawRangeElements','bufferData','bufferSubData']){
        const original=type.prototype[name];if(!original)continue;
        type.prototype[name]=function(...args){
          const result=original.apply(this,args);
          if(name.startsWith('draw'))window.__draws++;else window.__bufferUploads++;
          return result;
        };
      }
    }
  `});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  let serverReady=false;
  for(let i=0;i<50;i++){
    try{const response=await fetch(origin+'/',{signal:AbortSignal.timeout(1000)});await response.arrayBuffer();serverReady=true;break;}
    catch{await delay(100);}
  }
  assert.ok(serverReady,'Root serve.py failed to start on port 8768');
  await send('Page.navigate',{url:origin+'/webgl/v4/'});
  let ready=false;
  for(let i=0;i<100;i++){
    ready=await evaluate('document.querySelector("#pause")?.disabled===false && window.__draws>0');
    if(ready)break;
    await delay(100);
  }
  assert.ok(ready,'v4 scene missing or failed to render: '+errors.join('; '));
  assert.equal(await evaluate('location.pathname'),'/webgl/v4/');
  assert.equal(await evaluate('document.querySelector("#loading").hidden'),true);
  await selected('[data-quality=eco]');
  let clip=await canvasClip();
  const initial=await shot('desktop-start',clip);
  await delay(650);
  assert.notEqual(await shot(null,clip),initial,'Scene must move on opening without a playback click');
  assert.equal(await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")'),'false');
  await delay(200);
  const movingA=await shot('flow-start',clip);
  const sample=await evaluate('({draws:window.__draws,uploads:window.__bufferUploads,time:performance.now()})');
  await delay(1000);
  const later=await evaluate('({draws:window.__draws,uploads:window.__bufferUploads,time:performance.now()})');
  console.log('ECO sample (1-second requested window; submitted draw calls, not FPS): '+JSON.stringify({
    elapsedMs:Math.round(later.time-sample.time),submittedDraws:later.draws-sample.draws,bufferUploads:later.uploads-sample.uploads
  }));
  // No absolute FPS thresholds: one rendered frame can contain many draw calls.
  await delay(600);
  assert.notEqual(await shot('flow-later',clip),movingA,'Starting playback produces no actual canvas motion');
  await click('#pause');
  await selected('#pause');
  await stable('Manual pause');
  const paused=await shot(null,clip);
  await delay(350);
  assert.equal(await shot(null,clip),paused,'Canvas keeps moving while manually paused');

  // Fixed-view regression: no keyboard rotation, no drag rotation, no reset button.
  // Assert canvas is absent of tabindex focus affordance.
  assert.equal(await evaluate('document.querySelector("#scene").getAttribute("tabindex")')  ,null,'#scene must not have a tabindex attribute');
  // Assert cursor style is not grab (no drag hint).
  assert.ok(
    !['grab','grabbing'].includes(await evaluate('getComputedStyle(document.querySelector("#scene")).cursor')),
    '#scene cursor must not be grab/grabbing'
  );
  // Assert reset button absent.
  assert.equal(await evaluate('document.querySelector("#reset")')  ,null,'#reset button must not exist in fixed-view page');
  // Assert Arrow keys do not alter the paused canvas (no keyboard rotation listener).
  // Focus the parent button if available, else dispatch directly via CDP with body focus
  // so that Arrow keys do not cause page scroll (the canvas has no tabindex).
  await evaluate(`(()=>{
    const btn=document.querySelector("#pause");
    if(btn)btn.focus({preventScroll:true});
    else document.body.focus();
  })()`);
  await delay(100);
  const beforeKey=await shot(null,clip);
  // Dispatch key events to the document via DOM so they hit any potential canvas listeners
  // but the canvas has no tabindex so it won't receive them from CDP focus.
  await evaluate(`(()=>{
    for(const type of ['keydown','keyup']){
      document.querySelector('#scene').dispatchEvent(new KeyboardEvent(type,{key:'ArrowRight',code:'ArrowRight',bubbles:true,cancelable:true}));
    }
  })()`);
  await delay(200);
  assert.equal(await shot(null,clip),beforeKey,'Canvas changed after ArrowRight key (unexpected rotation listener)');
  await evaluate(`(()=>{
    for(const type of ['keydown','keyup']){
      document.querySelector('#scene').dispatchEvent(new KeyboardEvent(type,{key:'Home',code:'Home',bubbles:true,cancelable:true}));
    }
  })()`);
  await delay(200);
  assert.equal(await shot(null,clip),beforeKey,'Canvas changed after Home key (unexpected reset listener)');
  await stable('After keyboard non-rotation');
  // Assert mouse drag does not alter the paused canvas (no drag rotation listener).
  const point=await evaluate('(()=>{const r=document.querySelector("#scene").getBoundingClientRect();return {x:r.x+r.width*.48,y:r.y+r.height*.48}})()');
  const beforeDrag=await shot(null,clip);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
  for(let i=1;i<=4;i++)await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+i*20,y:point.y+i*8,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+80,y:point.y+32,button:'left',buttons:0,clickCount:1});
  await delay(200);
  assert.equal(await shot(null,clip),beforeDrag,'Canvas changed after mouse drag (unexpected drag rotation listener)');
  await stable('After drag non-rotation');
  await evaluate('document.activeElement.blur&&document.activeElement.blur()');
  await delay(200);

  const ecoSize=await evaluate('({width:document.querySelector("#scene").width,height:document.querySelector("#scene").height})');
  const beforeQuality=await evaluate('window.__draws');
  await click('[data-quality=detail]');
  await selected('[data-quality=detail]');
  await stable('Detail mode while paused');
  assert.ok(await evaluate('window.__draws')>beforeQuality,'Detail control did not submit a redraw');
  const detailSize=await evaluate('({width:document.querySelector("#scene").width,height:document.querySelector("#scene").height})');
  assert.ok(detailSize.width>=ecoSize.width&&detailSize.height>=ecoSize.height,'Detail mode reduces render resolution');
  await selected('#pause');
  const light=await shot(null,clip);
  await click('[data-bg=dark]');
  await selected('[data-bg=dark]');
  await stable('Dark background');
  const dark=await shot('dark-detail',clip);
  assert.notEqual(dark,light,'Dark button does not visibly change the canvas background');
  await click('[data-bg=checker]');
  await selected('[data-bg=checker]');
  await stable('Checker background');
  assert.notEqual(await shot('checker-detail',clip),dark,'Checker button does not visibly change the background');
  await click('[data-bg=light]');
  await stable('Detail close-up');
  await shot('optical-detail',await canvasClip(true));
  await click('#pause');
  await delay(200);
  const detailMotion=await shot(null,clip);
  await delay(1000);
  assert.notEqual(await shot(null,clip),detailMotion,'Detail mode fails to animate after resume');
  await click('[data-quality=eco]');
  await selected('[data-quality=eco]');

  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:400,deviceScaleFactor:1,mobile:false});
  await evaluate('window.scrollTo(0,document.body.scrollHeight)');
  await delay(250);
  assert.ok(await evaluate('document.querySelector("#visual").getBoundingClientRect().bottom<=0'),'Offscreen test must hide the entire visual');
  await stable('Offscreen autopause');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate('window.scrollTo(0,0)');
  await delay(300);
  const resumed=await evaluate('window.__draws');
  await delay(600);
  assert.ok(await evaluate('window.__draws')>resumed,'Animation did not resume after scrolling back');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await stable('Reduced-motion preference');
  clip=await canvasClip();
  const reduced=await shot(null,clip);
  await delay(350);
  assert.equal(await shot(null,clip),reduced,'Reduced-motion canvas is not visually still');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await delay(300);
  const restored=await evaluate('window.__draws');
  await delay(600);
  assert.ok(await evaluate('window.__draws')>restored,'Motion preference recovery did not resume playback');
  await click('#pause');
  await stable('Manual pause before mobile');

  for(const width of [390,320]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate('window.scrollTo(0,0)');
    await delay(250);
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Horizontal overflow at '+width);
    await shot('mobile-'+width);
    await evaluate('document.querySelector("#scene").scrollIntoView({block:"center",inline:"nearest",behavior:"instant"})');
    await stable('Mobile '+width);
    assert.ok(await evaluate('(()=>{const r=document.querySelector("#scene").getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=-.5&&r.left>=-.5&&r.bottom<=innerHeight+.5&&r.right<=innerWidth+.5})()'),'Entire canvas must fit in the scrolled viewport at '+width);
    await shot('mobile-model-'+width);
  }
  // Exercise the actual powder shader with a controlled opaque-depth field.
  // A front black surface must occlude grains; a rear surface must not.
  const powderDepth=await evaluate(`(async()=>{
    const THREE=await import('/webgl/vendor/three.module.js');
    const {createPowder}=await import('/webgl/v4/powder.mjs');
    const renderer=new THREE.WebGLRenderer({alpha:true,powerPreference:'low-power'});
    renderer.setSize(96,96);renderer.setClearColor(0,0);
    const target=new THREE.WebGLRenderTarget(96,96);
    const pixels=new Uint8Array(96*96*4),depthBytes=new Uint8Array(4);
    const depth=new THREE.DataTexture(depthBytes,1,1);depth.needsUpdate=true;
    const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-.065,.065,.065,-.065,.1,10);
    camera.position.z=2;
    const powder=createPowder(Array.from({length:4},()=>({grains:[[0,0,0]]})),{value:0},160,
      {depth:{value:depth},resolution:{value:new THREE.Vector2(96,96)}});
    scene.add(powder);renderer.setRenderTarget(target);
    const coverage=()=>{renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,96,96,pixels);let alpha=0;for(let i=3;i<pixels.length;i+=4)alpha+=pixels[i];return alpha;};
    try{
      const hidden=coverage();depthBytes.fill(255);depth.needsUpdate=true;
      const visible=coverage();return {hidden,visible};
    }finally{powder.geometry.dispose();powder.material.dispose();depth.dispose();target.dispose();renderer.dispose();renderer.forceContextLoss();}
  })()`);
  assert.ok(powderDepth.visible>0,'Powder fixture must actually render grains');
  assert.equal(powderDepth.hidden,0,'Powder is drawn over a foreground opaque sphere');
  const backdrop=await evaluate('window.__backdropProbe()');
  assert.equal(backdrop[3],255,'Known light backdrop must participate in radiance, not only CSS compositing');
  [238,241,243].forEach((value,i)=>assert.ok(Math.abs(backdrop[i]-value)<=2,'Rendered backdrop must match CSS appearance'));
  const overlap=await evaluate('window.__overlapProbe()');
  console.log('Foreground contamination probe: '+JSON.stringify(overlap));
  for(const result of overlap.filter(r=>r.z===-6))assert.equal(result.leaked,0,'Foreground sphere leaves a displaced stripe outside its direct silhouette');
  assert.ok(overlap.find(r=>r.z===-12.5).changed>0,'Rear sphere disappeared from transparent resin');
  assert.deepEqual(errors,[],'Runtime, shader, console or HTTP errors');
  assert.deepEqual(external,[],'External requests attempted (blocked before sending)');
  console.log('WEBGL v4 PASS: autoplays in eco, real screenshot motion, stable GPU pause, eco draw sample, fixed-view (no keyboard/drag rotation, no reset, no tabindex, no grab cursor), detail/backgrounds, offscreen pause/resume, reduced motion, full-canvas 390/320px, local requests only.');
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  closing=true;
  if(ws&&ws.readyState===1){try{await send('Browser.close')}catch{}ws.close();}
  killChildren();
  for(const call of calls.values()){clearTimeout(call.timer);call.reject(Error('CDP session closed'));}
  calls.clear();
  try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:200});}
  catch(error){console.warn('Temporary profile cleanup incomplete: '+error.message);}
  clearTimeout(watchdog);
  console.log('Temporary WebGL v4 browser and root server closed.');
});
