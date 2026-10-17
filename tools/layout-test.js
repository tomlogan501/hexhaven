// Measure the new board-first layout: canvas coverage, HUD positions, overlap.
const fs = require('fs');
const path = require('path');
const { WebSocket } = require('ws');

class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.events=[];}
  static async attach(u){
    const ws=new WebSocket(u,{maxPayload:256*1024*1024});const c=new CDP(ws);
    await new Promise((res,rej)=>{ws.on('open',res);ws.on('error',rej);});
    ws.on('message',m=>{const msg=JSON.parse(m);
      if(msg.id&&c.pending.has(msg.id)){const{res,rej}=c.pending.get(msg.id);
        c.pending.delete(msg.id);msg.error?rej(new Error(JSON.stringify(msg.error))):res(msg.result);}
      else if(msg.method)c.events.push(msg);});
    return c;
  }
  send(m,q={}){const id=++this.id;this.ws.send(JSON.stringify({id,method:m,params:q}));
    return new Promise((res,rej)=>this.pending.set(id,{res,rej}));}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
    return r.result.value;}
  close(){this.ws.close();}
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fail=0;
const check=(n,c,x)=>{console.log((c?'PASS  ':'FAIL  ')+n+(x?'  '+x:''));if(!c)fail++;};

(async()=>{
  const list=await(await fetch('http://127.0.0.1:9333/json')).json();
  const page=list.find(t=>t.type==='page');
  const c=await CDP.attach(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride',
    {width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  // Load via file:// — the game no longer needs the local server (artwork is
  // inlined in js/art.js), and the server is not running.
  await c.send('Page.navigate',{url:'file:///C:/Users/Thomas/Documents/hexhaven/index.html'});
  await sleep(4500);

  const errs=c.events.filter(e=>e.method==='Runtime.exceptionThrown')
    .map(e=>e.params.exceptionDetails.exception?.description);
  check('no JS exceptions after relayout', errs.length===0, errs.join(' | '));

  const L=JSON.parse(await c.eval(`(() => {
    const cv=document.getElementById('board');
    const r=cv.getBoundingClientRect();
    const panels={};
    for(const id of ['hud-players','hud-log','hud-hand','hud-hint']){
      const el=document.getElementById(id);
      if(!el){ panels[id]=null; continue; }
      const b=el.getBoundingClientRect();
      panels[id]={x:Math.round(b.left),y:Math.round(b.top),
        w:Math.round(b.width),h:Math.round(b.height),
        vis:getComputedStyle(el).display!=='none'};
    }
    // Board art extent: sea is rgb(22,32,43).
    const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    let minX=1e9,maxX=-1,minY=1e9,maxY=-1;
    for(let y=0;y<cv.height;y+=3){
      for(let x=0;x<cv.width;x+=3){
        const i=(y*cv.width+x)*4;
        if(d[i+2]>d[i] && d[i+2]>60 && d[i]<80) continue;   // sea gradient
        if(x<minX)minX=x; if(x>maxX)maxX=x;
        if(y<minY)minY=y; if(y>maxY)maxY=y;
      }
    }
    return JSON.stringify({
      win:{w:innerWidth,h:innerHeight},
      canvasCss:{w:Math.round(r.width),h:Math.round(r.height)},
      backing:{w:cv.width,h:cv.height},
      panels,
      art:{minX,maxX,minY,maxY,
        fillW:+(((maxX-minX)/cv.width)*100).toFixed(1),
        fillH:+(((maxY-minY)/cv.height)*100).toFixed(1)},
      scale:null
    });
  })()`));

  const sc=JSON.parse(await c.eval(`(() => {
    const cv=document.getElementById('board');
    const map=MAPGEN.build(2);
    return JSON.stringify(RENDER.makeProjection(map.view,cv.width,cv.height).scale);
  })()`));

  console.log('window:    '+JSON.stringify(L.win));
  console.log('canvas CSS:'+JSON.stringify(L.canvasCss));
  console.log('backing:   '+JSON.stringify(L.backing));
  console.log('board art: '+JSON.stringify(L.art)+'  scale='+sc.toFixed(2));
  for (const [k,v] of Object.entries(L.panels))
    console.log('  '+k.padEnd(13)+(v?`${v.w}x${v.h} @ ${v.x},${v.y}`:'MISSING'));

  check('canvas fills the stage width',
    Math.abs(L.canvasCss.w - L.win.w) < 3, L.canvasCss.w+' vs '+L.win.w);
  check('canvas fills the stage height',
    Math.abs(L.canvasCss.h - (L.win.h - 40)) < 40, L.canvasCss.h+' tall');
  check('no fixed sidebar remains', await c.eval(`!document.getElementById('side')`));
  check('board art fills >=60% of width', L.art.fillW>=60, L.art.fillW+'%');
  check('board art fills >=70% of height', L.art.fillH>=70, L.art.fillH+'%');
  check('scale is now generous (>2.2)', sc>2.2, sc.toFixed(2));

  // HUD panels must not cover the board centre.
  const cx=L.win.w/2, cy=(L.win.h+40)/2;
  const overlaps=[];
  for(const [k,v] of Object.entries(L.panels)){
    if(!v||!v.vis) continue;
    if(cx>v.x&&cx<v.x+v.w&&cy>v.y&&cy<v.y+v.h) overlaps.push(k);
  }
  check('no HUD panel covers the board centre', overlaps.length===0, overlaps.join(','));

  // The hand panel must be visible and hold the resources.
  check('hand panel visible with 5 chips',
    L.panels['hud-hand'].vis &&
    await c.eval(`document.querySelectorAll('#hand .res').length`)===5);

  const shot=await c.send('Page.captureScreenshot',{format:'png'});
  fs.mkdirSync(path.join(__dirname,'out'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'out','new-layout.png'),Buffer.from(shot.data,'base64'));
  console.log('\nsaved new-layout.png');
  c.close();
  console.log('\n'+(fail?fail+' FAILED':'layout is board-first'));
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(2);});