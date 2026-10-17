// Watch the human's hand across a single road build: what changed, and how many times.
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
  await c.send('Page.navigate',{url:'http://127.0.0.1:8765/index.html'});
  await sleep(4500);

  const r = await c.eval(`(async () => {
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const out=[];
    const hand=()=>{
      const o={};
      for(const el of document.querySelectorAll('#hand .res')){
        const name=el.textContent.trim().split(/\\s|×/)[0];
        const m=el.textContent.match(/-?\\d+/g);
        if(m) o[name]=+m[m.length-1];
      }
      return o;
    };
    const logText=()=>document.getElementById('log').textContent;
    const cv=document.getElementById('board');

    document.getElementById('btn-new').click();
    await sleep(300);

    const sweep=async(want)=>{
      const rect=cv.getBoundingClientRect();
      for(let gx=0.12;gx<=0.94;gx+=0.014){
        for(let gy=0.12;gy<=0.94;gy+=0.014){
          cv.dispatchEvent(new MouseEvent('click',{clientX:rect.left+rect.width*gx,
            clientY:rect.top+rect.height*gy,bubbles:true}));
          await sleep(0);
          if(logText().includes(want)) return true;
        }
      }
      return false;
    };

    await sweep('You founded your first settlement');
    await sleep(150);
    out.push('after free settlement: '+JSON.stringify(hand()));

    document.querySelector('[data-build="road"]').click();
    await sweep('You built your first road');
    await sleep(150);
    out.push('after FREE setup road: '+JSON.stringify(hand()));

    for(let i=0;i<6;i++){ document.getElementById('btn-pass').click(); await sleep(1400); }
    // Confirm we are actually out of setup and in the build phase before
    // claiming a "paid" road: a setup road is free and gains tiles instead.
    const statusNow=document.getElementById('status').textContent;
    out.push('status before paid road: '+statusNow);
    const inSetup=/settlement|road/i.test(statusNow) &&
      /You:/.test(statusNow);
    out.push('still in setup? '+inSetup);
    if(inSetup){ out.push('ABORT: never left setup, cannot test a paid road'); return JSON.stringify(out); }

    document.getElementById('btn-roll').click();
    await sleep(700);
    out.push('after roll: '+JSON.stringify(hand()));
    out.push('status: '+document.getElementById('status').textContent);

    const beforePaid=hand();
    document.querySelector('[data-build="road"]').click();
    await sleep(60);
    const rect=cv.getBoundingClientRect();
    let placed=false;
    for(let gx=0.12;gx<=0.94&&!placed;gx+=0.02){
      for(let gy=0.12;gy<=0.94&&!placed;gy+=0.02){
        const n0=logText().length;
        cv.dispatchEvent(new MouseEvent('click',{clientX:rect.left+rect.width*gx,
          clientY:rect.top+rect.height*gy,bubbles:true}));
        await sleep(0);
        if(logText().length>n0){ placed=true; }
      }
    }
    out.push('paid road placed: '+placed);
    out.push('log tail: '+logText().slice(-90));
    const afterPaid=hand();
    out.push('BEFORE paid road: '+JSON.stringify(beforePaid));
    out.push('AFTER  paid road: '+JSON.stringify(afterPaid));
    const delta={};
    for(const k in afterPaid){
      const d=afterPaid[k]-(beforePaid[k]||0);
      if(d!==0) delta[k]=d;
    }
    out.push('DELTA: '+JSON.stringify(delta));
    out.push('road cost: '+JSON.stringify(RULES.COST.road));
    return JSON.stringify(out);
  })()`);

  JSON.parse(r).forEach(l=>console.log(l));
  c.close();
})().catch(e=>{console.error('FATAL',e);process.exit(2);});