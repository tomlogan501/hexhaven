// Scroll the landing page to reveal the room list / create-room area and click it.
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
  await sleep(8000);

  for (let y=0; y<4000; y+=600) {
    await c.eval(`window.scrollTo(0,${y}); true`);
    await sleep(700);
  }
  await sleep(2000);

  const r = await c.eval(`(() => {
    const vis=e=>e && e.offsetParent !== null;
    const byText=re=>[...document.querySelectorAll('button,a,div[role=button],span')]
      .filter(e=>vis(e) && re.test((e.innerText||'').trim()));
    const order=[/^(Ouvrir|Regarder)$/, /^Créer un salon$/,
                 /Jouer en ligne/, /^Jouer$/, /Démarrer la partie/];
    for(const re of order){
      const el=byText(re)[0];
      if(el){ el.scrollIntoView(); el.click(); return 'clicked '+re; }
    }
    return 'nothing clickable; '+byText(/.+/).length+' visible';
  })()`);
  console.log('action:', r);
  await sleep(9000);

  // A room list may need a second click after the modal mounts.
  if (await c.eval(`/Salles ouvertes/.test(document.body.innerText)`)) {
    const second = await c.eval(`(() => {
      const els=[...document.querySelectorAll('button,a')]
        .filter(e=>e.offsetParent && /^(Ouvrir|Regarder)$/.test((e.innerText||'').trim()));
      if(els[0]){ els[0].click(); return 'joined a listed room'; }
      return 'no listed rooms';
    })()`);
    console.log('second action:', second);
    await sleep(9000);
  }

  console.log('URL:', await c.eval('location.href'));
  const d=JSON.parse(await c.eval(`(() => {
    const txt=(document.body.innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,2000);
    const canv=[...document.querySelectorAll('canvas')].map(c=>({w:c.width,h:c.height}));
    const btns=[...new Set([...document.querySelectorAll('button,a,[role=button]')]
      .filter(b=>b.offsetParent)
      .map(b=>(b.innerText||b.title||b.getAttribute('aria-label')||'').trim())
      .filter(t=>t&&t.length<45))].slice(0,70);
    return JSON.stringify({txt,canv,btns,svgs:document.querySelectorAll('svg').length});
  })()`));
  console.log('CANVASES:',JSON.stringify(d.canv),' SVGS:',d.svgs);
  console.log('\nVISIBLE CONTROLS:'); d.btns.forEach(b=>console.log('  '+b));
  console.log('\nTEXT:\n'+d.txt);

  fs.mkdirSync(path.join(__dirname,'out'),{recursive:true});
  const s=await c.send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(__dirname,'out','colonist-game.png'),Buffer.from(s.data,'base64'));
  console.log('\nsaved colonist-game.png');
  c.close();
})().catch(e=>{console.error('FATAL',e);process.exit(2);});