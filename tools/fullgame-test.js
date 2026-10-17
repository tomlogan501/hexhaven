// Click the debug button and verify a COMPLETE game is played to a winner.
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
  await c.send('Page.reload',{ignoreCache:true});
  await sleep(2500);

  check('debug button exists', await c.eval(`!!document.getElementById('btn-debug')`));

  await c.eval(`document.getElementById('btn-debug').click(); true`);
  console.log('Clicked Debug. Playing full game...');

  let last='';
  for (let i=0;i<180;i++){                     // up to 3 minutes
    await sleep(1000);
    const st=await c.eval(`JSON.stringify({
      log: document.getElementById('log').textContent,
      over: document.getElementById('status').textContent,
      btn: document.getElementById('btn-debug').textContent,
      scores: [...document.querySelectorAll('#players .player')].map(r=>r.textContent)
    })`);
    const s=JSON.parse(st);
    last=s.log;
    if (i%15===0) console.log(`  [${i+1}s] ${s.over} | ${s.scores.join(' / ')}`);
    if (/GAME OVER/.test(s.log) || /turn cap/.test(s.log)) {
      console.log('FINISHED:', /GAME OVER/.test(s.log) ? 'game over' : 'cap reached');
      break;
    }
    if (/Debug: error/.test(s.log)) break;
  }

  const tail=last.split(/(?=Debug: )/).slice(-6).join('\n');
  console.log('\n--- log tail ---\n'+tail);

  const res=JSON.parse(await c.eval(`JSON.stringify({
    over: /GAME OVER/.test(document.getElementById('log').textContent),
    cap: /turn cap/.test(document.getElementById('log').textContent),
    err: /Debug: error/.test(document.getElementById('log').textContent),
    scores: [...document.querySelectorAll('#players .player')].map(r=>r.textContent.trim()),
    btn: document.getElementById('btn-debug').textContent,
    disabled: document.getElementById('btn-debug').disabled,
    status: document.getElementById('status').textContent,
    built: document.querySelectorAll('#log div').length
  })`));

  check('no debug error', !res.err);
  check('button label restored', /auto-play/.test(res.btn), res.btn);
  check('button re-enabled', !res.disabled);
  check('a winner was declared', res.over || res.cap, JSON.stringify(res.scores));
  if (res.over) {
    const m=last.match(/GAME OVER — (.+?) wins with (\d+) VP after (\d+) turns/);
    check('winner + VP + turn count reported', !!m, m?m[0]:last.slice(-120));
    if (m) check('winner reached 10+ VP', parseInt(m[2])>=10, 'vp='+m[2]);
    if (m) check('game ran a plausible length', +m[3]>=20 && +m[3]<=400, 'turns='+m[3]);
  }
  check('final status mentions a winner', /wins/i.test(res.status), res.status);

  const exc=c.events.filter(e=>e.method==='Runtime.exceptionThrown');
  check('no uncaught exceptions', exc.length===0,
    exc.map(e=>e.params.exceptionDetails.exception?.description).join(' | '));

  const shot=await c.send('Page.captureScreenshot',{format:'png'});
  fs.mkdirSync(path.join(__dirname,'out'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'out','fullgame.png'),Buffer.from(shot.data,'base64'));
  console.log('saved fullgame.png');

  c.close();
  console.log('\n'+(fail?fail+' FAILED':'all full-game checks passed'));
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(2);});