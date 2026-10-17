// Capture the Colonist in-game HUD layout: panel positions, sizes, roles.
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
  await c.send('Page.navigate',{url:'https://colonist.io/fr#land3260'});
  await sleep(12000);

  const d=JSON.parse(await c.eval(`(() => {
    const root=document.querySelector('.ui-game-container');
    const panels=[...document.querySelectorAll('div')].filter(e=>{
      const s=getComputedStyle(e);
      if(s.position!=='absolute'&&s.position!=='fixed') return false;
      return e.offsetWidth>=60&&e.offsetHeight>=40;
    }).map(e=>{
      const s=getComputedStyle(e);
      const r=e.getBoundingClientRect();
      return {
        cls:String(e.className).slice(0,60),
        x:Math.round(r.left),y:Math.round(r.top),
        w:Math.round(r.width),h:Math.round(r.height),
        radius:s.borderRadius,
        bg:s.backgroundColor,
        text:(e.innerText||'').replace(/\\n/g,' | ').slice(0,90)
      };
    }).filter(p=>p.text);
    // Sort into a readable layout map, grouped by screen corner.
    const corner=p=>{
      const cx=p.x+p.w/2, cy=p.y+p.h/2;
      return (cy<500?'top':'bottom')+'-'+(cx<533?'L':cx<1067?'C':'R');
    };
    const map={};
    for(const p of panels){
      const k=corner(p);
      (map[k]=map[k]||[]).push(p);
    }
    const canv=[...document.querySelectorAll('canvas')].map(c=>({
      id:c.id,w:c.width,h:c.height,
      style:(c.getAttribute('style')||'').replace(/\\s+/g,' ').slice(0,150)}));
    const imgs=[...document.querySelectorAll('img')].map(i=>({
      src:i.src.split('/').pop().slice(0,70),w:i.width,h:i.height}));
    return JSON.stringify({map,canv,imgs:imgs.slice(0,30),
      body:(document.body.innerText||'').slice(0,700)});
  })()`));

  for (const k of Object.keys(d.map).sort()) {
    console.log('\n=== '+k.toUpperCase()+' ('+d.map[k].length+' panels) ===');
    d.map[k].forEach(p=>console.log(
      `  ${String(p.w)+'x'+String(p.h)} @ ${p.x},${p.y}  ${p.cls}\n`+
      `      "${p.text}"`));
  }
  console.log('\nCANVASES:'); d.canv.forEach(c=>console.log('  '+c.id+' '+c.w+'x'+c.h+'\n     '+c.style));
  console.log('\nIMAGES:'); d.imgs.forEach(i=>console.log(`  ${i.w}x${i.h}  ${i.src}`));

  fs.mkdirSync(path.join(__dirname,'out'),{recursive:true});
  const s=await c.send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(__dirname,'out','colonist-hud.png'),Buffer.from(s.data,'base64'));
  console.log('\nsaved colonist-hud.png');
  c.close();
})().catch(e=>{console.error('FATAL',e);process.exit(2);});