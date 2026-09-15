/**
 * embed-host.js — root-level host loader for the OTS resin iframe.
 * Usage: <script src="embed-host.js" defer></script>
 * Host markup: <iframe id="resin-frame" data-src="webgl/v4/embed.html" ...></iframe>
 *
 * Contract:
 *   Child → parent: {type:'ots-resin-ready'}
 *   Parent → child: {type:'ots-resin-visibility', visible:boolean}
 *
 * Behaviour:
 *   - Iframe src is set lazily when the element nears the viewport (IntersectionObserver rootMargin 200px).
 *   - After child posts ots-resin-ready, parent sends current visibility immediately.
 *   - Parent monitors IntersectionObserver on the iframe + document visibility + pageshow/pagehide.
 *   - Child is fail-closed: no visibility message → scene stays paused.
 *   - Messages validated: only same-origin child, only known types.
 */
(function(){
  const frame=document.querySelector('iframe#resin-frame');
  if(!frame)return;

  const dataSrc=frame.dataset.src;
  if(!dataSrc)return;

  let loaded=false;
  let childReady=false;
  // Visible from this frame's perspective (intersection + page visibility).
  let hostVisible=false;

  function sendVisibility(visible){
    if(!childReady)return;
    try{
      frame.contentWindow.postMessage({type:'ots-resin-visibility',visible},location.origin);
    }catch(_){}
  }

  function updateVisibility(){
    // Combine page visibility, intersection, and host CSS hide of the iframe.
    const cssHidden=frame.offsetParent===null||
      getComputedStyle(frame).visibility==='hidden'||
      getComputedStyle(frame).display==='none';
    const v=!document.hidden&&hostVisible&&!cssHidden;
    sendVisibility(v);
  }

  // Load iframe src when near viewport.
  const loadObserver=new IntersectionObserver(entries=>{
    if(!loaded&&entries[0].isIntersecting){
      loaded=true;
      loadObserver.disconnect();
      frame.src=dataSrc;
    }
  },{rootMargin:'200px'});
  loadObserver.observe(frame);

  // Track iframe intersection for visibility signal.
  const visObserver=new IntersectionObserver(entries=>{
    hostVisible=entries[0].isIntersecting;
    updateVisibility();
  },{threshold:0});
  visObserver.observe(frame);

  // Page-level visibility events.
  document.addEventListener('visibilitychange',updateVisibility);
  window.addEventListener('pagehide',()=>sendVisibility(false));
  window.addEventListener('pageshow',updateVisibility);
  // Detect CSS hide applied directly to iframe (visibility/display changes).
  const styleObserver=new MutationObserver(updateVisibility);
  for(let node=frame;node;node=node.parentElement){
    styleObserver.observe(node,{attributes:true,attributeFilter:['style','class','hidden']});
  }

  // Listen for child ready handshake.
  window.addEventListener('message',function(e){
    if(!e.data||typeof e.data!=='object')return;
    // Validate same-origin source is our iframe.
    if(e.origin!==location.origin||e.source!==frame.contentWindow)return;
    if(e.data.type==='ots-resin-ready'){
      childReady=true;
      // Send current visibility state immediately.
      updateVisibility();
    }
  });
})();
