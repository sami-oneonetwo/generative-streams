// Fixture-only restart smoke: child process launch, HTTP input, socket observation.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-restart-'));
const port = process.env.RESTART_SMOKE_PORT ?? '4412';
const url = `http://127.0.0.1:${port}`;
const token = 'restart-smoke-operator-token';
let child, socket, scene, log = '';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeout=30000) { const deadline=Date.now()+timeout; while(!predicate()){if(Date.now()>deadline)throw new Error(`Timeout: ${label}\n${log.slice(-3000)}`);await delay(100);} }
async function start(){
 scene=undefined;
 child=spawn(process.execPath,['--import','tsx','src/index.ts'],{cwd:process.cwd(),env:{...process.env,WORLD:'safehouse',SAFEHOUSE_FIXTURES:'1',KICK_DISABLED:'true',KICK_REPLIES_ENABLED:'false',DATA_DIR:dir,PORT:port,ADMIN_TOKEN:token,DEV_TIME_SCALE:'1'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>{log+=d});child.stderr.on('data',d=>{log+=d});
 let ready=false;for(let i=0;i<100&&!ready;i++){if(child.exitCode!==null)throw new Error('Server exited '+log);try{ready=(await fetch(url+'/admin/api/status',{headers:{Authorization:`Bearer ${token}`}})).ok}catch{}if(!ready)await delay(100)}
 assert.ok(ready,'HTTP startup');socket=new WebSocket(url.replace('http:','ws:')+'/ws');socket.on('message',d=>{const m=JSON.parse(String(d));if(m.t==='state')scene=m.scene.safehouse});await waitFor(()=>scene,'socket snapshot');
}
async function stop(){socket?.close();if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;} }
async function api(endpoint,body){const r=await fetch(url+'/admin/api'+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});assert.ok(r.ok,`${endpoint}: ${r.status}`)}
try{
 await start();assert.equal(scene.fixture,true);
 await api('/chat',{username:'restart-check',text:'Build a duck-shaped watchtower in the rear yard'});
 await waitFor(()=>scene.current?.status==='walking'||scene.current?.status==='building','active construction');
 const jobId=scene.current.id;await stop();await start();
 await waitFor(()=>scene.objects.length===1,'resumed completion',90000);
 const objectId=scene.objects[0].id;await stop();await start();
 assert.equal(scene.objects.length,1);assert.equal(scene.objects[0].id,objectId);
 await delay(2500);assert.equal(scene.objects.length,1,'no duplicate on recovery');
 console.log(JSON.stringify({ok:true,jobId,objectId,restarts:2}));
}finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
