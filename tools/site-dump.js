// Load a site in Brave and dump its rendered structure for UI reference.
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
const target = process.argv[2] || 'https://colonist.io/fr';
const outName = process.argv[3] || 'site';

(async()=>{
  const list=await(await fetch('http://127.0.0.1:9333/json')).json();
  const page=list.find(t=>t.type==='page');
  const c=await CDP.attach(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride',
    {width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await c.send('Page.navigate',{url:target});
  await sleep(9000);

  const dump=JSON.parse(await c.eval(`(() => {
    const txt = (document.body.innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,2500);
    const buttons = [...document.querySelectorAll('button,a,[role=button]')]
      .map(b => (b.innerText||b.title||b.getAttribute('aria-label')||'').trim())
      .filter(t => t && t.length < 40);
    const imgs = [...document.querySelectorAll('img')]
      .map(i => i.src).slice(0,25);
    const canvases = [...document.querySelectorAll('canvas')].map(c => ({
      w:c.width,h:c.height, cls:c.className, id:c.id,
      style:(c.getAttribute('style')||'').slice(0,120)
    }));
    const svgs = document.querySelectorAll('svg').length;
    const colors = {};
    for (const el of document.querySelectorAll('*')) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg!=='rgba(0, 0, 0, 0)' && bg!=='transparent') {
        colors[bg]=(colors[bg]||0)+1;
      }
    }
    const top = Object.entries(colors).sort((a,b)=>b[1]-a[1]).slice(0,18);
    return JSON.stringify({
      title: document.title,
      url: location.href,
      text: txt,
      buttons: [...new Set(buttons)].slice(0,60),
      imgs, canvases, svgs, palette: top
    });
  })()`));

  console.log('TITLE:', dump.title);
  console.log('URL:', dump.url);
  console.log('\nCANVASES:', JSON.stringify(dump.canvases,null,1));
  console.log('SVG COUNT:', dump.svgs);
  console.log('\nIMAGES:'); dump.imgs.forEach(i=>console.log('  '+i.slice(0,140)));
  console.log('\nBUTTONS/LABELS:'); dump.buttons.forEach(b=>console.log('  '+b));
  console.log('\nTOP COLOURS:');
  dump.palette.forEach(([k,v])=>console.log(`  ${k}  x${v}`));
  console.log('\nVISIBLE TEXT:\n'+dump.text);

  fs.mkdirSync(path.join(__dirname,'out'),{recursive:true});
  const shot=await c.send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(__dirname,'out',outName+'.png'),Buffer.from(shot.data,'base64'));
  console.log('\nsaved '+outName+'.png');
  c.close();
})().catch(e=>{console.error('FATAL',e);process.exit(2);});