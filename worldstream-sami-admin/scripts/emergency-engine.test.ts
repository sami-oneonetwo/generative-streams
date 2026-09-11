import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TaskQueue } from '../src/engine/tasks';
import { ProtagonistModel } from '../src/engine/protagonist';
import { Engine } from '../src/engine/engine';
import { IntentPipeline } from '../src/engine/intents';
import { ChatRateMeter } from '../src/engine/chatRate';
import type { WorldCtx, WorldModule } from '../src/engine/world';

function queueHarness(){
  const queue=new TaskQueue<{}>();const p=new ProtagonistModel(0,100);
  const ctx={state:{},log:()=>{}} as unknown as WorldCtx<{}>;
  return {queue,p,ctx,advance:(now:number,emergency=false)=>queue.advance(now,p,ctx,emergency)};
}

test('emergency interrupts mid-walk at actual position; normal work cannot finish',()=>{
  const h=queueHarness();let completed=0;
  h.queue.enqueue({kind:'normal',label:'normal',targetX:100,workMs:1000,onComplete:()=>completed++});
  h.advance(0);h.advance(500,true);
  assert.equal(h.p.x,50);assert.equal(h.p.walk,undefined);
  h.advance(100000,true);assert.equal(completed,0);
  h.advance(100001);h.advance(101001);h.advance(102001);assert.equal(completed,1);
});

test('mid-work suspension retains progress and runs onStart once; recovery jumps parked work',()=>{
  const h=queueHarness();let started=0,completed=0,repaired=0;
  h.queue.enqueue({kind:'normal',label:'normal',targetX:0,workMs:1000,onStart:()=>started++,onComplete:()=>completed++});
  h.advance(0);h.advance(200);h.advance(600,true);
  h.queue.enqueue({kind:'recovery',label:'repair',targetX:0,workMs:200,emergency:true,onComplete:()=>repaired++});
  h.advance(700,true);h.advance(900,true);h.advance(1100,true);
  assert.equal(repaired,1);assert.equal(completed,0);
  h.advance(1200);h.advance(1400);
  assert.equal(started,1);assert.equal(h.queue.progress(1400),0.4);
  h.advance(1999);assert.equal(completed,0);
  h.advance(2000);assert.equal(completed,1);
});

test('an async intent response is suppressed if an emergency interrupts it',async()=>{
  let resolve!: (line:string)=>void;
  let speaking=0,queued=0;
  const state={emergency:false};
  const p=new ProtagonistModel(0,100);const tasks=new TaskQueue<typeof state>();
  const engine=Object.create(Engine.prototype) as Engine<typeof state>;
  const ctx:WorldCtx<typeof state>={
    state,now:Date.now(),tuning:{},chatRatePerMin:0,rng:()=>0.5,log:()=>{},
    say:()=>speaking++,enqueueTask:()=>{queued++;return{id:'t'};},queue:[],
    llm:{dialogue:()=>new Promise<string>(r=>{resolve=r;}),moderate:async()=>({ok:true})},
  };
  Object.assign(engine,{
    state,ctx,tasks,protagonist:p,recentChat:[],chatRevision:0,classifications:[],chatRate:new ChatRateMeter(),
    log:{push:()=>{}},generation:0,
    world:{emergency:(s:typeof state)=>s.emergency,audible:(s:typeof state)=>!s.emergency,
      quickClassify:()=>({intent:'ask'}),fallbackIntent:'ask',
      intents:[{name:'ask',description:'',examples:[],async handle(c:WorldCtx<typeof state>){
        const line=await c.llm.dialogue({instruction:'reply'});
        if(line)c.say(line);
        c.enqueueTask({kind:'ordinary',label:'ordinary',targetX:0,workMs:1,onComplete:()=>{}});
      }}],
    } as unknown as WorldModule<typeof state>,
  });
  const pipeline=new IntentPipeline(engine);
  const pending=pipeline.handle({id:'m1',userId:'u1',username:'guest',text:'hi',ts:Date.now(),source:'dev'});
  state.emergency=true;engine.syncMode();resolve('stale reply');await pending;
  assert.equal(speaking,0);assert.equal(queued,0);
  await pipeline.handle({id:'m2',userId:'u2',username:'guest2',text:'help',ts:Date.now(),source:'dev'});
  assert.equal(pipeline.heldCount,1);assert.equal(engine.recentChat.length,1);
});
