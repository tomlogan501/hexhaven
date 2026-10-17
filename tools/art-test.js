// Verify the SVG art sheet renders: symbols resolve, instances paint, board draws.
const fs = require('fs');
const path = require('path');
const { WebSocket } = require('ws');

class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.events=[];}
  static async attach(u){
    const ws=new WebSocket(u,{maxPayload:256*1024*1024}); const c=new CDP(ws);
    await new Promise((res,rej)=>{ws.on('open',res);ws.on('error',rej);});
    ws.on('message',m=>{const msg=JSON.parse(m);
      if(msg.id&&c.pending.has(msg.id)){const{res,rej}=c.pending.get(msg.id);c.pending.delete(msg.id);
        msg.error?rej(new Error(JSON.stringify(msg.error))):res(msg.result);}
      else if(msg.method)c.events.push(msg);});
    return c;
  }
  send(method,params={}){const id=++this.id;this.ws.send(JSON.stringify({id,method,params}));
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
  await c.send('Page.navigate',{url:'http://127.0.0.1:8765/art-sheet.html'});
  await sleep(3000);

  const errs=c.events.filter(e=>e.method==='Runtime.exceptionThrown')
    .map(e=>e.params.exceptionDetails.exception?.description);
  check('no JS exceptions', errs.length===0, errs.join(' | '));

  const probe=JSON.parse(await c.eval(`JSON.stringify({
    symbols: document.querySelectorAll('symbol').length,
    hexInstances: document.querySelectorAll('#hexes svg').length,
    pieceInstances: document.querySelectorAll('#pieces svg').length,
    cardInstances: document.querySelectorAll('#cards svg').length,
    harborInstances: document.querySelectorAll('#harbors svg').length,
    boardSvg: !!document.querySelector('#board svg'),
    boardUse: document.querySelectorAll('#board svg use').length,
    boardHex: document.querySelectorAll('#board svg ellipse').length,
    boardText: document.querySelectorAll('#board svg text').length,
    artNodes: document.querySelectorAll('symbol polygon,symbol rect,symbol ellipse,symbol path,symbol circle').length
  })`));

  check('all symbol defs loaded (16)', probe.symbols===16, 'got '+probe.symbols);
  check('6 resource hexes render', probe.hexInstances===6, 'got '+probe.hexInstances);
  check('3 pieces render', probe.pieceInstances===3, 'got '+probe.pieceInstances);
  check('2 harbors render', probe.harborInstances===2, 'got '+probe.harborInstances);
  check('5 dev cards render', probe.cardInstances===5, 'got '+probe.cardInstances);
  check('board svg present', probe.boardSvg);
  check('board places 19 hexes', probe.boardUse>=19, 'use='+probe.boardUse);
  check('board draws tokens', probe.boardHex>=18, 'ellipses='+probe.boardHex);
  check('board draws token numbers', probe.boardText>=36, 'texts='+probe.boardText);
  check('art has real geometry', probe.artNodes>80, 'nodes='+probe.artNodes);

  // Bounding box of the whole board: should be large and non-degenerate.
  const box=JSON.parse(await c.eval(`(() => {
    const s=document.querySelector('#board svg'); if(!s) return JSON.stringify({});
    const b=s.getBoundingClientRect();
    return JSON.stringify({w:Math.round(b.width),h:Math.round(b.height)});
  })()`));
  check('board has real dimensions', box.w>400 && box.h>300, box.w+'x'+box.h);

  const shot=await c.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  const out=path.join(__dirname,'out','art-sheet.png');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,Buffer.from(shot.data,'base64'));
  console.log('saved art-sheet.png ('+Math.round(shot.data.length*0.75/1024)+' KB)');

  c.close();
  console.log('\n'+(fail?fail+' FAILED':'all art checks passed'));
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(2);});