// Capture the game over file:// (no server) and report what is actually drawn.
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

(async()=>{
  const list=await(await fetch('http://127.0.0.1:9333/json')).json();
  const page=list.find(t=>t.type==='page');
  const c=await CDP.attach(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride',
    {width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  await c.send('Page.navigate',{url:'file:///C:/Users/Thomas/Documents/hexhaven/index.html'});
  await sleep(6000);

  const errs=c.events.filter(e=>e.method==='Runtime.exceptionThrown')
    .map(e=>e.params.exceptionDetails.exception?.description);
  console.log('exceptions:', errs.length ? errs.join(' | ') : 'none');

  const r=JSON.parse(await c.eval(`(() => {
    const out={};
    out.art = typeof ART;
    out.ready = typeof ART!=='undefined' ? ART.isReady() : null;
    out.symbols = document.querySelectorAll('#art-defs symbol').length;
    const cv=document.getElementById('board');
    out.canvas={w:cv.width,h:cv.height,cssW:Math.round(cv.getBoundingClientRect().width)};
    const map=MAPGEN.build(2);
    const sc=RENDER.makeProjection(map.view,cv.width,cv.height).scale;
    out.scale=sc;
    const want=Math.min(1400,Math.ceil(map.S*2*sc));
    // What size did preload ask for vs what draw asks for?
    const sprite=ART.tile('forest', Math.ceil(map.S*2*sc));
    out.sprite = sprite?{w:sprite.width,h:sprite.height}:null;
    if(sprite){
      const d=sprite.getContext('2d').getImageData(0,0,sprite.width,sprite.height).data;
      let lit=0,seen=new Set();
      for(let i=0;i<d.length;i+=4){ if(d[i+3]>8){lit++; seen.add(d[i]+','+d[i+1]+','+d[i+2]);} }
      out.spriteLit=lit; out.spriteColors=seen.size;
    }
    // Count distinct colours actually on the board canvas.
    const bd=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    const cnt=new Map();
    for(let i=0;i<bd.length;i+=4*5){
      const q=v=>Math.round(v/24)*24;
      const k=q(bd[i])+','+q(bd[i+1])+','+q(bd[i+2]);
      cnt.set(k,(cnt.get(k)||0)+1);
    }
    out.boardColors=cnt.size;
    out.topColors=[...cnt.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6)
      .map(([k,v])=>k+' '+(v/(bd.length/(4*5))*100).toFixed(1)+'%');
    out.status=document.getElementById('status').textContent;
    out.players=document.querySelectorAll('#players .player').length;
    out.hand=document.querySelectorAll('#hand .res').length;
    return JSON.stringify(out);
  })()`));

  console.log('ART:', JSON.stringify(r,null,1));

  const shot=await c.send('Page.captureScreenshot',{format:'png'});
  const out=path.join(__dirname,'out','review-now.png');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,Buffer.from(shot.data,'base64'));
  console.log('\nsaved review-now.png');
  c.close();
})().catch(e=>{console.error('FATAL',e);process.exit(2);});