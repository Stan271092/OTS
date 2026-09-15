// One temporary Edge instance. No downloads and no software-GPU override.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const root=__dirname;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ots-webgl-'));
const checks=path.join(root,'checks');
fs.mkdirSync(checks,{recursive:true});
const server=spawn('python',[path.join(root,'serve.py'),'--port','8768'],{cwd:root,stdio:'ignore'});
const browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
  '--headless=new','--no-first-run','--disable-extensions',
  '--disable-background-networking','--renderer-process-limit=1','--remote-debugging-port=0',
  `--user-data-dir=${profile}`,'about:blank'
],{stdio:'ignore'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let ws,id=0;
const calls=new Map(),errors=[],external=[];
const watchdog=setTimeout(()=>{browser.kill();server.kill();process.exit(1)},90000);
async function send(method,params={}){
  const n=++id;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{calls.delete(n);reject(Error(`${method} timed out`))},20000);
    calls.set(n,{resolve,reject,timer});
    ws.send(JSON.stringify({id:n,method,params}));
  });
}
async function evaluate(expression){
  const value=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  assert.ok(!value.exceptionDetails,JSON.stringify(value.exceptionDetails));
  return value.result.value;
}
async function shot(name){
  const value=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  if(name)fs.writeFileSync(path.join(checks,name+'.png'),Buffer.from(value.data,'base64'));
  return value.data;
}
async function stable(){
  const count=await evaluate('window.__draws');
  await delay(260);
  assert.equal(await evaluate('window.__draws'),count,'GPU keeps rendering during automatic/manual pause');
}
(async()=>{
  let port;
  for(let i=0;i<100;i++){
    const file=path.join(profile,'DevToolsActivePort');
    if(fs.existsSync(file)){port=fs.readFileSync(file,'utf8').split('\n')[0];break;}
    await delay(100);
  }
  assert.ok(port,'Browser unavailable');
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{
    const value=JSON.parse(event.data),call=calls.get(value.id);
    if(call){clearTimeout(call.timer);calls.delete(value.id);value.error?call.reject(Error(JSON.stringify(value.error))):call.resolve(value.result);}
    if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails.text);
    if(value.method==='Runtime.consoleAPICalled'&&value.params.type==='error')errors.push(value.params.args.map(a=>a.value||a.description).join(' '));
    if(value.method==='Log.entryAdded'&&value.params.entry.level==='error')errors.push(value.params.entry.text);
    if(value.method==='Network.requestWillBeSent'&&!value.params.request.url.startsWith('http://127.0.0.1:8768/')&&!value.params.request.url.startsWith('data:'))external.push(value.params.request.url);
  });
  for(const domain of ['Page','Runtime','Log','Network'])await send(domain+'.enable');
  // Observe real GPU submissions, forwarding unchanged to the actual WebGL methods.
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__draws=0;
    for(const type of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){
      if(!type)continue;
      for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){
        const original=type.prototype[name]; if(!original)continue;
        type.prototype[name]=function(...args){window.__draws++;return original.apply(this,args)};
      }
    }
  `});
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:8768/index.html'});
  let ready=false;
  for(let i=0;i<100;i++){
    ready=await evaluate('document.querySelector("#pause")?.disabled===false && window.__draws>0');
    if(ready)break;
    await delay(100);
  }
  assert.ok(ready,'Scene failed to render: '+errors.join('; '));
  assert.equal(await evaluate('document.querySelector("#loading").hidden'),true);
  assert.ok(await evaluate(`(()=>{const c=document.querySelector('canvas'),gl=c.getContext('webgl2')||c.getContext('webgl');return gl.getContextAttributes().antialias && c.width>=c.clientWidth})()`),'Sphere edges require MSAA and at least native pixel resolution');
  const movingA=await shot('desktop');
  await delay(700);
  const movingB=await shot();
  assert.ok(movingA!==movingB,'Visible 3D does not move');
  await evaluate('document.querySelector("#pause").click()');
  await delay(160);
  const pausedA=await shot();
  await delay(350);
  const pausedB=await shot();
  assert.ok(pausedA===pausedB,'Visible 3D moves during manual pause');
  await stable();
  const beforeKey=await shot();
  await evaluate('document.querySelector("canvas").focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight'});
  await delay(100);
  assert.ok(beforeKey!==await shot(),'Keyboard rotation did not redraw paused scene');
  await evaluate('document.querySelector("#reset").click()');
  await evaluate('document.querySelector("[data-bg=dark]").click();document.querySelector("[data-quality=detail]").click()');
  await delay(250);
  assert.equal(await evaluate('document.querySelector("#pause").getAttribute("aria-pressed")'),'true');
  await stable();
  await shot('dark');
  // Inspect the optical overlap at native resolution, not an enlarged low-DPR crop.
  await evaluate('document.querySelector("[data-bg=light]").click()');
  await delay(180);
  const region=await evaluate(`(()=>{const r=document.querySelector('#scene').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()`);
  const detail=await send('Page.captureScreenshot',{format:'png',clip:region});
  fs.writeFileSync(path.join(checks,'optical-detail.png'),Buffer.from(detail.data,'base64'));
  await evaluate('document.querySelector("#pause").click()');
  const detailA=await shot('flow-start');
  await delay(2200);
  assert.ok(detailA!==await shot('flow-later'),'Animation stopped after quality switch');
  await evaluate('document.querySelector("[data-bg=checker]").click();document.querySelector("[data-quality=eco]").click()');
  await delay(200);
  await shot('checker');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:400,deviceScaleFactor:1,mobile:false});
  await evaluate('window.scrollTo(0,document.body.scrollHeight)');
  await delay(200);
  assert.ok(await evaluate('document.querySelector("#visual").getBoundingClientRect().bottom<=0'),'Test requires the entire canvas offscreen');
  await stable();
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate('window.scrollTo(0,0)');
  await delay(200);
  const afterScroll=await evaluate('window.__draws');
  await delay(250);
  assert.ok(await evaluate('window.__draws')>afterScroll,'Did not resume after scrolling back');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await delay(200);
  await stable();
  await evaluate('document.querySelector("[data-bg=light]").click()');
  for(const width of [390,320]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    await delay(200);
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Horizontal overflow at '+width);
    await shot('mobile-'+width);
    await evaluate('document.querySelector("#visual").scrollIntoView({block:"center"})');
    await delay(200);
    await shot('mobile-model-'+width);
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual(external,[]);
  console.log('WEBGL PASS: visible 3D motion, pause stops GPU, keyboard, quality/resume, backgrounds, offscreen pause/resume, reduced motion, 390/320px, local requests, no runtime errors.');
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  clearTimeout(watchdog);
  if(ws&&ws.readyState===1){try{await send('Browser.close')}catch{}ws.close();}
  browser.kill();server.kill();
  console.log('Temporary WebGL browser and server closed.');
});
