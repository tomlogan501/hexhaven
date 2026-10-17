// Verify the board is FLAT (no tilt/shear) and fills the canvas.
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
  await c.send('Page.navigate',{url:'http://127.0.0.1:8765/index.html'});
  await sleep(3500);

  const errs=c.events.filter(e=>e.method==='Runtime.exceptionThrown')
    .map(e=>e.params.exceptionDetails.exception?.description);
  check('no JS exceptions', errs.length===0, errs.join(' | '));

  // Geometry: a top-down projection means equal x/y scaling, no offset.
  const g=JSON.parse(await c.eval(`(() => {
    const map = MAPGEN.build(2);
    const cv = document.getElementById('board');
    const p = RENDER.makeProjection(map.view, cv.width, cv.height);
    const o = p.project(0,0);
    const dx = p.project(100,0);
    const dy = p.project(0,100);
    return JSON.stringify({
      scale: p.scale,
      dxPer100: dx.x - o.x,
      dyX: dy.x - o.x,          // must be 0: no shear
      dyPer100: dy.y - o.y,
      centreX: o.x, centreY: o.y,
      w: cv.width, h: cv.height
    });
  })()`));

  check('x and y scale identically (square, no squash)',
    Math.abs(g.dxPer100 - g.dyPer100) < 0.01,
    'dx='+g.dxPer100.toFixed(3)+' dy='+g.dyPer100.toFixed(3));
  check('no horizontal shear from y',
    Math.abs(g.dyX) < 0.01, 'shear='+g.dyX.toFixed(3));
  check('board centred in canvas',
    Math.abs(g.centreX - g.w/2) < 1 && Math.abs(g.centreY - g.h/2) < 1,
    g.centreX.toFixed(0)+','+g.centreY.toFixed(0)+' of '+g.w+'x'+g.h);

  // Scale should now be usable (the old 3D version rendered at 1.52).
  check('board scale is reasonable', g.scale > 2.5, 'scale='+g.scale.toFixed(2));

  // The rendered board must occupy a good share of the canvas.
  const cov=JSON.parse(await c.eval(`(() => {
    const cv=document.getElementById('board');
    const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    // Sea colour is #16202b-ish; anything else is board art.
    let minX=1e9,maxX=-1,minY=1e9,maxY=-1;
    for(let y=0;y<cv.height;y+=2){
      for(let x=0;x<cv.width;x+=2){
        const i=(y*cv.width+x)*4;
        const r=d[i],g2=d[i+1],b=d[i+2];
        const isSea = Math.abs(r-22)<12 && Math.abs(g2-32)<12 && Math.abs(b-43)<12;
        if(isSea) continue;
        if(x<minX)minX=x; if(x>maxX)maxX=x;
        if(y<minY)minY=y; if(y>maxY)maxY=y;
      }
    }
    return JSON.stringify({minX,maxX,minY,maxY,w:cv.width,h:cv.height});
  })()`));
  const fillW=(cov.maxX-cov.minX)/cov.w, fillH=(cov.maxY-cov.minY)/cov.h;
  check('board fills most of the canvas width', fillW>0.6,
    (fillW*100).toFixed(0)+'% (x '+cov.minX+'..'+cov.maxX+')');
  check('board fills most of the canvas height', fillH>0.6,
    (fillH*100).toFixed(0)+'% (y '+cov.minY+'..'+cov.maxY+')');
  check('board is not clipped at the edges',
    cov.minX>0 && cov.minY>0 && cov.maxX<cov.w && cov.maxY<cov.h,
    JSON.stringify(cov));

  const shot=await c.send('Page.captureScreenshot',{format:'png'});
  fs.mkdirSync(path.join(__dirname,'out'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'out','flat-board.png'),Buffer.from(shot.data,'base64'));
  console.log('saved flat-board.png');

  c.close();
  console.log('\n'+(fail?fail+' FAILED':'all flat-view checks passed'));
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(2);});