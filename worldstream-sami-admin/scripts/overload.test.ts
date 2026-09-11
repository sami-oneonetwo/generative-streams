import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialState, roomCapacityPerMin, serverRoomStateSchema, type Server, type ServerRoomState } from '../src/worlds/server-room/state';
import { ensureEmergencyTask, startEmergency, updateEmergency } from '../src/worlds/server-room/emergency';
import { updateTraffic } from '../src/worlds/server-room/traffic';
import { applyOfflineTime } from '../src/worlds/server-room/offline';
import { audible } from '../src/worlds/server-room/outage';
import { intents } from '../src/worlds/server-room/intents';
import type { TaskSpec, WorldCtx } from '../src/engine/world';
import { tuning } from '../src/worlds/server-room/tuning';
import { TaskQueue } from '../src/engine/tasks';
import { ProtagonistModel } from '../src/engine/protagonist';
import { tick } from '../src/worlds/server-room/tick';

const now = 1_800_000_000_000;
function harness(count = 3, state = createInitialState(now)) {
  for (let i=0; i<count; i++) state.servers[`s${i}`] = {
    id:`s${i}`, slot:i, ownerUserId:`u${i}`, ownerName:`guest${i}`, name:`mine${i}`,
    health:100-i, level:1, temperature:22, powerDrawW:190, uptimeDays:9,
    delivered:5000+i, createdAt:now-100000, darkStreams:0,
  } satisfies Server;
  const tasks: TaskSpec<ServerRoomState>[] = [];
  const said: string[] = [];
  const ctx: WorldCtx<ServerRoomState> = {
    state, now, tuning, chatRatePerMin:300, rng:()=>0.5,
    say:t=>{said.push(t);}, log:()=>{},
    enqueueTask:t=>{tasks.push(t);return {id:`t${tasks.length}`};},
    get queue(){return tasks.map((t,i)=>({id:`t${i}`,kind:t.kind,label:t.label}));},
    llm:{dialogue:async()=>null,moderate:async()=>({ok:false})},
  };
  return {state,ctx,tasks,said,complete(){const t=tasks.shift();assert.ok(t);t.onComplete(ctx);return t.kind;}};
}

test('any demand above capacity needs 2s; reaching the limit resets it',()=>{
  const h=harness();
  h.state.traffic.demandPerMin=roomCapacityPerMin(h.state)+1;
  updateEmergency(h.ctx,1000);
  assert.equal(h.state.emergency,undefined);
  h.state.traffic.demandPerMin=roomCapacityPerMin(h.state);
  updateEmergency(h.ctx,2000);
  assert.equal(h.state.traffic.overloadForMs,undefined);
  assert.equal(h.state.emergency,undefined);
  h.state.traffic.demandPerMin=roomCapacityPerMin(h.state)+1;
  updateEmergency(h.ctx,1999);assert.equal(h.state.emergency,undefined);
  updateEmergency(h.ctx,1);assert.ok(h.state.emergency);
  updateEmergency(h.ctx,30000);
  assert.equal(h.state.season.outages,1);
  assert.equal(h.tasks.length,1);
  assert.equal(audible(h.state),false);
});

test('adding capacity raises the failure limit and cancels the pending overload',()=>{
  const h=harness(0);
  assert.equal(roomCapacityPerMin(h.state),10);
  h.state.traffic.demandPerMin=11;
  updateEmergency(h.ctx,1000);
  assert.equal(h.state.emergency,undefined);
  harness(1,h.state); // Add a healthy server while the warning is active.
  assert.ok(roomCapacityPerMin(h.state)>11);
  updateEmergency(h.ctx,2000);
  assert.equal(h.state.emergency,undefined);
  assert.equal(h.state.traffic.overloadForMs,undefined);
  h.state.traffic.demandPerMin=roomCapacityPerMin(h.state)+1;
  updateEmergency(h.ctx,2000);
  assert.ok(h.state.emergency);
});

test('all service stops until physical replacement, reset and boot; records survive',()=>{
  const h=harness();
  const original=structuredClone(h.state.servers);
  startEmergency(h.ctx,4);
  assert.equal(h.state.emergency?.serverIds.length,3);
  const delivered=h.state.traffic.delivered;
  updateTraffic(h.ctx,60000);
  assert.equal(h.state.traffic.delivered,delivered);
  assert.ok(h.state.traffic.dropped>0);
  const stages:string[]=[];
  while(h.state.emergency){assert.equal(audible(h.state),false);stages.push(h.complete());assert.ok(stages.length<15);}
  assert.deepEqual(stages,[...Array.from({length:3},()=>['emergency-pull','emergency-exchange','emergency-install']).flat(),'emergency-reset','emergency-boot']);
  assert.equal(audible(h.state),true);
  for(const s of Object.values(h.state.servers)){
    const before=original[s.id];
    for(const key of ['id','ownerUserId','ownerName','name','level','delivered','createdAt'] as const) assert.equal(s[key],before[key],key);
    assert.equal(s.health,100);
  }
  h.state.traffic.demandPerMin=10000;
  updateEmergency(h.ctx,59000);assert.equal(h.state.emergency,undefined);
  updateEmergency(h.ctx,1000);assert.equal(h.state.emergency,undefined);
  updateEmergency(h.ctx,2000);assert.ok(h.state.emergency);
});

test('empty room replaces its control machine without creating an owner',()=>{
  const h=harness(0);startEmergency(h.ctx);
  assert.deepEqual(h.state.emergency?.serverIds,[]);
  const stages:string[]=[];
  while(h.state.emergency) stages.push(h.complete());
  assert.deepEqual(stages,['emergency-pull','emergency-exchange','emergency-install','emergency-reset','emergency-boot']);
  assert.deepEqual(h.state.servers,{});
  assert.ok(audible(h.state));
});

test('every saved stage reconstructs idempotently after restart without losing victims',()=>{
  for(const stage of ['pull','exchange','install','reset','boot'] as const){
    const h=harness(1);startEmergency(h.ctx);h.state.emergency!.stage=stage;
    if(stage==='reset'||stage==='boot') h.state.emergency!.index=1;
    const loaded=serverRoomStateSchema.parse(JSON.parse(JSON.stringify(h.state)));
    const resumed=harness(0,loaded);
    ensureEmergencyTask(resumed.ctx);ensureEmergencyTask(resumed.ctx);
    assert.equal(resumed.tasks.length,1);
    assert.equal(resumed.tasks[0].kind,`emergency-${stage}`);
    loaded.lastLiveAt=now-10*86400000;loaded.servers.s0.darkStreams=99;
    applyOfflineTime(resumed.ctx);
    assert.ok(loaded.servers.s0);assert.ok(loaded.emergency);
    assert.equal(resumed.tasks.length,1);
  }
  assert.equal(serverRoomStateSchema.parse(createInitialState(now)).emergency,undefined);
});

test('stale callbacks and direct owner restarts cannot bypass recovery',async()=>{
  const h=harness(1);startEmergency(h.ctx);
  const old=h.tasks[0];
  h.state.emergency!.startedAt++;
  old.onComplete(h.ctx);assert.equal(h.state.emergency!.stage,'pull');
  await intents.find(i=>i.name==='restart')!.handle(h.ctx,{id:'m',userId:'u0',username:'guest0',text:'restart mine',ts:now,source:'dev'},{});
  assert.equal(h.state.servers.s0.health,0);assert.equal(h.tasks.length,1);
});

test('real task queue completes the full recovery while normal work is parked',()=>{
  const h=harness(2);
  const queue=new TaskQueue<ServerRoomState>();
  const p=new ProtagonistModel(896,340);
  let time=now, normalDone=0;
  const ctx:WorldCtx<ServerRoomState>={...h.ctx,
    get now(){return time;},get queue(){return queue.view();},
    enqueueTask:spec=>queue.enqueue(spec),
  };
  queue.enqueue({kind:'upgrade',label:'ordinary work',targetX:200,workMs:45000,onComplete:()=>normalDone++});
  queue.advance(time,p,ctx);
  startEmergency(ctx,3);
  for(let i=0;i<400&&h.state.emergency;i++){
    time+=500;
    queue.advance(time,p,ctx,!!h.state.emergency);
    if(i%4===0)tick(ctx,2000);
    assert.equal(normalDone,0);
  }
  assert.equal(h.state.emergency,undefined,'all physical stages should finish on the real queue');
  assert.equal(h.state.season.outages,1);
  assert.ok(queue.view().some(t=>t.kind==='upgrade'),'interrupted request remains queued');
});

test('restore never clears an emergency while installed hardware is over budget',()=>{
  const h=harness(1);startEmergency(h.ctx);
  h.state.power.budgetW=1;
  h.complete();h.complete();h.complete();h.complete();
  assert.equal(h.state.emergency?.stage,'reset');
  assert.equal(audible(h.state),false);
  h.state.power.budgetW=2000;
  ensureEmergencyTask(h.ctx);h.complete();h.complete();
  assert.equal(h.state.emergency,undefined);
});
