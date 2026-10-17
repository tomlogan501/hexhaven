// Verify tiles actually TILE on screen: walk a horizontal scanline across the
// board and confirm hex faces abut with no sea-colour gaps between them.
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
  await c.send('Page.navigate',{url:'file:///C:/Users/Thomas/Documents/hexhaven/index.html'});
  await sleep(3500);

  // A scanline through the middle of the board should cross 5 hexes and the
  // sea only at the two ends. Internal sea gaps mean the tiles do not meet.
  const scan=JSON.parse(await c.eval(`(() => {
    const cv=document.getElementById('board');
    const cx=cv.getContext('2d');
    const map=MAPGEN.build(2);
    const p=RENDER.makeProjection(map.view,cv.width,cv.height);
    const d=cx.getImageData(0,0,cv.width,cv.height).data;
    const isSea=(r,g,b)=>Math.abs(r-22)<14&&Math.abs(g-32)<14&&Math.abs(b-43)<14;
    // Three rows: through the tile row centres.
    const rows=[-1,0,1].map(dq=>{
      const t=map.tiles.find(t=>t.q===dq&&t.r===0);
      const c=p.project(t.center.x,t.center.y);
      const y=Math.round(c.y);
      // Walk the whole width, find sea runs.
      let runs=[],start=null;
      for(let x=0;x<cv.width;x++){
        const i=(y*cv.width+x)*4;
        const s=isSea(d[i],d[i+1],d[i+2]);
        if(s&&start===null) start=x;
        if(!s&&start!==null){ if(x-start>2) runs.push([start,x]); start=null; }
      }
      if(start!==null&&cv.width-start>2) runs.push([start,cv.width]);
      return {y, runs};
    });
    return JSON.stringify(rows);
  })()`));

  // Expect exactly 2 sea runs per scanline (left edge, right edge).
  let edgeOnly=0;
  for (const row of scan) {
    const twoEnds = row.runs.length<=2 &&
      row.runs.every(r=>r[0]<40 || r[1]>1060);
    if (twoEnds) edgeOnly++;
    console.log(`  scanline y=${row.y}: ${row.runs.length} sea runs ` +
      row.runs.map(r=>`[${r[0]}..${r[1]}]`).join(' '));
  }
  check('no internal gaps: sea only at board edges', edgeOnly===3,
    edgeOnly+'/3 scanlines clean');

  // The sprite canvas must be wider than tall, like a flat-top hex.
  const spr=JSON.parse(await c.eval(`(() => {
    const cv=ART.tile('forest',84);
    return cv ? JSON.stringify({w:cv.width,h:cv.height,ratio:cv.width/cv.height}) : 'null';
  })()`));
  check('sprite canvas is flat-top shaped',
    spr !== 'null' && spr.ratio > 1.14 && spr.ratio < 1.17,
    JSON.stringify(spr));

  const shot=await c.send('Page.captureScreenshot',{format:'png'});
  fs.mkdirSync(path.join(__dirname,'out'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'out','tiled-board.png'),Buffer.from(shot.data,'base64'));
  console.log('saved tiled-board.png');
  c.close();
  console.log('\n'+(fail?fail+' FAILED':'tiles meet with no gaps'));
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(2);});