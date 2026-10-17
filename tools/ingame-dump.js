// Join a real Colonist game and dump the in-game HUD structure.
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

  await c.send('Page.navigate',{url:'https://colonist.io/fr'});
  await sleep(9000);

  const step = await c.eval(`(() => {
    const vis=e=>e && e.offsetParent!==null;
    const f=re=>[...document.querySelectorAll('button,a,div[role=button],span')]
      .filter(e=>vis(e)&&re.test((e.innerText||'').trim()));
    for(const re of [/^Jouer en ligne$/, /^(Ouvrir|Regarder)$/, /^Créer un salon$/,
                     /^1v1$/, /^Bots$/, /^Facile$/]){
      const el=f(re)[0];
      if(el){ el.click(); return 'clicked '+re; }
    }
    return 'no match; '+f(/.+/).length+' visible';
  })()`);
  console.log('step1:', step);
  await sleep(9000);

  const step2 = await c.eval(`(() => {
    const vis=e=>e && e.offsetParent!==null;
    const f=re=>[...document.querySelectorAll('button,a,div[role=button],span')]
      .filter(e=>vis(e)&&re.test((e.innerText||'').trim()));
    for(const re of [/^(Ouvrir|Regarder)$/, /^Démarrer la partie$/, /^Facile$/,
                     /^1v1$/, /^Classé$/, /^Bots$/]){
      const el=f(re)[0];
      if(el){ el.click(); return 'clicked '+re; }
    }
    return 'no match; '+f(/.+/).length+' visible';
  })()`);
  console.log('step2:', step2);
  await sleep(10000);

  console.log('URL:', await c.eval('location.href'));

  const d=JSON.parse(await c.eval(`(() => {
    const canv=[...document.querySelectorAll('canvas')].map(c=>({
      w:c.width,h:c.height,cls:String(c.className).slice(0,40),
      parent:(c.parentElement&&c.parentElement.className||'').slice(0,40)}));
    // HUD regions: absolutely positioned divs are the UI layer over the board.
    const hud=[...document.querySelectorAll('div')].filter(e=>{
      const s=getComputedStyle(e);
      return (s.position==='absolute'||s.position==='fixed')&&e.offsetWidth>40&&e.offsetHeight>20;
    }).map(e=>({
      cls:String(e.className).slice(0,45),
      x:Math.round(e.offsetLeft),y:Math.round(e.offsetTop),
      w:Math.round(e.offsetWidth),h:Math.round(e.offsetHeight)
    }));
    const btns=[...new Set([...document.querySelectorAll('button')]
      .filter(b=>b.offsetParent)
      .map(b=>(b.innerText||b.title||b.getAttribute('aria-label')||'').trim())
      .filter(t=>t&&t.length<40))].slice(0,70);
    const txt=(document.body.innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,1800);
    const colors={};
    for(const el of document.querySelectorAll('*')){
      const b=getComputedStyle(el).backgroundColor;
      if(b&&b!=='rgba(0, 0, 0, 0)') colors[b]=(colors[b]||0)+1;
    }
    return JSON.stringify({canv,hud:hud.slice(0,40),btns,txt,
      palette:Object.entries(colors).sort((a,b)=>b[1]-a[1]).slice(0,16)});
  })()`));

  console.log('\nCANVASES:', JSON.stringify(d.canv,null,1));
  console.log('\nHUD LAYERS:'); d.hud.forEach(h=>console.log('  '+JSON.stringify(h)));
  console.log('\nBUTTONS:'); d.btns.forEach(b=>console.log('  '+b));
  console.log('\nPALETTE:'); d.palette.forEach(([k,v])=>console.log(`  ${k} x${v}`));
  console.log('\nTEXT:\n'+d.txt);

  fs.mkdirSync(path.join(__dirname,'out'),{recursive:true});
  const s=await c.send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(__dirname,'out','colonist-ingame.png'),Buffer.from(s.data,'base64'));
  console.log('\nsaved colonist-ingame.png');
  c.close();
})().catch(e=>{console.error('FATAL',e);process.exit(2);});