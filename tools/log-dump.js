// Capture the FULL in-game log during a debug run, so failures can be
// diagnosed from what actually happened rather than from pass/fail counts.
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
  await c.send('Page.navigate',{url:'http://127.0.0.1:8765/index.html'});
  await sleep(3000);

  // Read the log directly from the page's own log array, every line.
  const READ = `JSON.stringify({
    lines: (function(){
      var out=[];
      var el=document.getElementById('log');
      if(!el) return ['<no #log element>'];
      var kids=el.querySelectorAll('div');
      for(var i=0;i<kids.length;i++) out.push(kids[i].textContent);
      return out;
    })(),
    status: document.getElementById('status').textContent,
    players: [].slice.call(document.querySelectorAll('#players .player')).map(function(r){return r.textContent;}),
    hand: [].slice.call(document.querySelectorAll('#hand .res')).map(function(r){return r.textContent;})
  })`;

  console.log('--- LOG BEFORE CLICK ---');
  let s=JSON.parse(await c.eval(READ));
  s.lines.forEach(l=>console.log('  '+l));
  console.log('  status: '+s.status);

  await c.eval(`document.getElementById('btn-debug').click(); true`);

  for (const at of [8, 20, 40]) {
    await sleep(at*1000 - (at===8?0:at===20?8000:20000));
    s=JSON.parse(await c.eval(READ));
    console.log(`\n--- LOG @${at}s (${s.lines.length} lines) ---`);
    s.lines.forEach(l=>console.log('  '+l));
    console.log('  players: '+s.players.join(' | '));
    console.log('  hand: '+s.hand.join(' '));
    console.log('  status: '+s.status);
    if (/GAME OVER|turn cap|Debug: error/.test(s.lines.join('\n'))) break;
  }

  const out=path.join(__dirname,'out','gamelog.txt');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out, s.lines.join('\n'));
  console.log('\nsaved gamelog.txt');
  c.close();
})().catch(e=>{console.error('FATAL',e);process.exit(2);});