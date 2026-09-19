import assert from 'node:assert/strict';import {createRequire} from 'node:module';import WebSocket from 'ws';
const require=createRequire(import.meta.url);const {chromium}=require('../.claude/preview-tools/node_modules/playwright');const base='http://127.0.0.1:4410';let state;
const ws=new WebSocket(base.replace('http:','ws:')+'/ws');ws.on('message',d=>{const m=JSON.parse(String(d));if(m.t==='state')state=m.scene.safehouse});
async function wait(fn,label,timeout=150000){const end=Date.now()+timeout;while(!fn()){if(Date.now()>end)throw new Error('Timed out '+label);await new Promise(r=>setTimeout(r,100))}}
async function api(path,body){const r=await fetch(base+'/admin/api'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok,await r.text())}
let browser;
try{await wait(()=>state,'connect');assert.equal(state.fixture,true);browser=await chromium.launch({headless:true,channel:'chrome'});const p=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);const admin=await browser.newPage();await admin.goto(base+'/admin');
async function build(text,user){await admin.locator('#inj-user').fill(user);await admin.locator('#inj-text').fill(text);await admin.locator('#inj-send').click();await wait(()=>state.current,'admission');await wait(()=>!state.current,'completion');}
await build('Build a barricade at 3,13','defender-one');await build('Build a turret at 6,11','defender-two');const built=state.objects.filter(o=>!o.fixed).slice(-2);assert.equal(built.length,2);assert.equal(built[0].role,'barrier');assert.equal(built[1].role,'turret');
await admin.getByRole('button',{name:'Send three zombies',exact:true}).click();await admin.getByRole('button',{name:'Start zombie simulation',exact:true}).click();await wait(()=>state.combat.kills>0,'turret kill');await p.screenshot({path:'.claude/preview-tools/safehouse-smoke/defense-active.png'});
await api('/action',{id:'safehouse-combat-pause'});const kills=state.combat.kills;assert.ok(kills>0);assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,kills,objects:built.map(o=>({name:o.blueprint.name,position:o.position,health:o.health,role:o.role})),neighborhoodPieces:state.objects.filter(o=>o.fixed).length,errors}));
}finally{ws.close();await browser?.close()}
