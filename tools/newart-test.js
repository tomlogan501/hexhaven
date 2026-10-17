// Verify the GAME uses the new SVG art (not the old procedural shapes).
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
  await sleep(4000);

  const errs=c.events.filter(e=>e.method==='Runtime.exceptionThrown')
    .map(e=>e.params.exceptionDetails.exception?.description);
  check('no JS exceptions', errs.length===0, errs.join(' | '));

  const st=JSON.parse(await c.eval(`JSON.stringify({
    artDefined: typeof ART,
    ready: typeof ART!=='undefined' ? ART.isReady() : false,
    symbols: document.querySelectorAll('#art-defs symbol').length,
    // A cached canvas that has actually painted pixels proves decode worked.
    hexCanvasPainted: (() => {
      const cv = ART.tile('forest', 84);
      if (!cv) return 'no canvas';
      const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
      const seen = new Set(); let lit = 0;
      for (let i=0;i<d.length;i+=4){
        if (d[i+3] < 8) continue;
        seen.add(d[i]+','+d[i+1]+','+d[i+2]); lit++;
      }
      return seen.size + ':' + lit;
    })()
  })`));

  check('ART module loaded', st.artDefined==='object', st.artDefined);
  check('symbols injected into DOM', st.symbols>=10, 'got '+st.symbols);
  check('sprites decoded (isReady)', st.ready===true);

  const parts=String(st.hexCanvasPainted).split(':');
  check('forest hex canvas has art pixels',
    parts[0] !== 'no canvas' && +parts[0] > 8 && +parts[1] > 500,
    st.hexCanvasPainted);

  // The board must show the art's terrain hues. The top face is squashed and
  // blended with the sea, so match on hue families rather than exact RGB.
  const board=JSON.parse(await c.eval(`(() => {
      const cv=document.getElementById('board');
      const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
      let lit=0;
      const fam={green:0,lightgreen:0,yellow:0,brown:0,grey:0,sand:0};
      for(let i=0;i<d.length;i+=4){
        const r=d[i],g=d[i+1],b=d[i+2];
        if(r>30||g>30||b>40) lit++;
        // Only vivid, reasonably bright pixels count as terrain art.
        if (r<70||g<70) continue;
        if (g>r+20 && g>b+20) { if (g>150) fam.lightgreen++; else fam.green++; }
        else if (r>150 && g>130 && b<120) fam.yellow++;
        else if (r>120 && g>70 && g<160 && b<110 && r>b+40) fam.brown++;
        else if (Math.abs(r-g)<18 && Math.abs(g-b)<18 && r>90 && r<190) fam.grey++;
        else if (r>190 && g>180 && b>130) fam.sand++;
      }
      return JSON.stringify({lit, fam});
    })()`));
    const f=board.fam;
    const kinds=Object.values(f).filter(v=>v>500).length;
    check('board paints multiple terrain hues', kinds>=3, JSON.stringify(f));
    check('wood tiles render green', f.green>500, 'green='+f.green);
    check('pasture tiles render light green', f.lightgreen>500, 'lg='+f.lightgreen);
    check('board is well painted', board.lit>30000, 'lit='+board.lit);

  const shot=await c.send('Page.captureScreenshot',{format:'png'});
  fs.mkdirSync(path.join(__dirname,'out'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'out','game-newart.png'),Buffer.from(shot.data,'base64'));
  console.log('saved game-newart.png');

  c.close();
  console.log('\n'+(fail?fail+' FAILED':'all new-art checks passed'));
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(2);});