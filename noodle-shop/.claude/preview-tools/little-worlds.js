(() => {
'use strict';
const stages = [...document.querySelectorAll('.stage')];
if (!window.THREE) { stages.forEach(s => s.querySelector('.fallback').textContent = 'The 3D library could not load. Open this page online in a WebGL-enabled browser.'); return; }
const T = THREE;
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
const btn = document.getElementById('motion');
function updateButton(){btn.textContent=paused?'Resume motion':'Pause motion';btn.setAttribute('aria-pressed',String(paused));}
btn.addEventListener('click',()=>{paused=!paused;updateButton();});updateButton();
const all=[];
function makeWorld(container,style){
 const night=style==='garden',block=style==='block';
 const scene=new T.Scene();
 const bg=night?0x183348:block?0xc6ddd4:0xdaeae4;
 scene.background=new T.Color(bg);
 const renderer=new T.WebGLRenderer({antialias:true,alpha:false});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
 renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=night?1.3:1.1;
 container.prepend(renderer.domElement);renderer.domElement.setAttribute('aria-label',style+' interactive 3D concept scene');renderer.domElement.setAttribute('role','img');
 const camera=new T.PerspectiveCamera(34,1,.1,200);
 const group=new T.Group();scene.add(group);
 const mats=new Map();
 const mat=(c,em=false)=>{const k=c+':'+em;if(!mats.has(k))mats.set(k,new T.MeshStandardMaterial({color:c,roughness:.87,metalness:0,emissive:em?c:0,emissiveIntensity:em?1.6:0}));return mats.get(k);};
 const animations=[];
 function mesh(geo,c,x=0,y=0,z=0,parent=group,em=false){const m=new T.Mesh(geo,mat(c,em));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
 function box(w,h,d,c,x,y,z,p=group){return mesh(new T.BoxGeometry(w,h,d),c,x,y,z,p);}
 function ball(r,c,x,y,z,p=group){return mesh(new T.SphereGeometry(r,block?6:18,block?4:12),c,x,y,z,p);}
 function cyl(rt,rb,h,c,x,y,z,p=group,n=16){return mesh(new T.CylinderGeometry(rt,rb,h,n),c,x,y,z,p);}
 function rod(a,b,r,c,p=group){const av=new T.Vector3(...a),bv=new T.Vector3(...b),d=bv.clone().sub(av);const m=cyl(r,r,d.length(),c,0,0,0,p,8);m.position.copy(av.add(bv).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return m;}
 function label(text,x,y,z,w=1.8,back='#eee7c9',ink='#45534a'){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=160;const c=canvas.getContext('2d');c.fillStyle=back;c.fillRect(0,0,512,160);c.fillStyle=ink;c.font='bold 57px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(text,256,83,470);const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;const m=new T.Mesh(new T.PlaneGeometry(w,w*160/512),new T.MeshStandardMaterial({map:tex,roughness:1}));m.position.set(x,y,z);group.add(m);return m;}
 function flower(x,z,c=0xf8d66e,s=1){rod([x,.02,z],[x,.48*s,z],.025,0x4b805c);if(block)box(.19*s,.18*s,.19*s,c,x,.5*s,z);else{for(let a=0;a<5;a++){let t=a*1.256;ball(.1*s,c,x+Math.cos(t)*.1*s,.51*s,z+Math.sin(t)*.1*s);}ball(.075*s,0xf5cd6b,x,.55*s,z);}}
 function tree(x,z,s=1,kind=0){const c=night?0x47796c:block?0x5a985d:0x71a682;box(.22*s,1.45*s,.23*s,0x947e5e,x,.65*s,z);if(block){box(1.35*s,1.1*s,1.4*s,c,x,1.65*s,z);box(.95*s,.75*s,1*s,0x82b265,x,2.35*s,z);}else if(kind){cyl(0,1.1*s,1.65*s,c,x,1.7*s,z,group,7);cyl(0,.83*s,1.55*s,night?0x568e7d:0x90bd94,x,2.4*s,z,group,7);}else{ball(.95*s,c,x,1.8*s,z);ball(.66*s,night?0x5a8c79:0x99be83,x+.25*s,2.3*s,z);}}
 function fence(x,z,len=2){for(let i=0;i<=len;i++){box(.12,.7,.12,0xe9d9b1,x+i,.35,z);}box(len+.2,.12,.12,0xe9d9b1,x+len/2,.31,z);box(len+.2,.12,.12,0xe9d9b1,x+len/2,.59,z);}
 function bench(x,z,rot=0){const p=new T.Group();p.position.set(x,0,z);p.rotation.y=rot;group.add(p);box(1.65,.15,.65,0xc6a16f,0,.55,0,p);box(1.65,.45,.12,0xd8b888,0,.95,-.3,p);[-.6,.6].forEach(xx=>{box(.12,.55,.5,0x6e7969,xx,.26,0,p);box(.12,.7,.12,0x6e7969,xx,.7,-.3,p);});}
 function duck(x,z,s=1,king=false){const p=new T.Group();p.position.set(x,.17,z);group.add(p);if(block){box(.8*s,.5*s,.5*s,0xf4d46e,0,.3*s,0,p);box(.42*s,.42*s,.42*s,0xf6dd7e,.29*s,.68*s,0,p);box(.28*s,.12*s,.24*s,0xd9864d,.59*s,.61*s,0,p);}else{const b=ball(.37*s,0xf4d46e,0,.27*s,0,p);b.scale.set(1.45,.85,1);ball(.24*s,0xf8dd87,.36*s,.64*s,0,p);const be=ball(.15*s,0xe59155,.6*s,.59*s,0,p);be.scale.set(1,.5,.6);ball(.2*s,0xe5ba57,-.08*s,.37*s,.29*s,p).scale.set(1.3,.5,.35);}ball(.035*s,0x313f36,.44*s,.71*s,.19*s,p);if(king){cyl(.17*s,.13*s,.17*s,0xeab845,.36*s,.94*s,0,p,6);for(let i=0;i<3;i++)box(.065*s,.12*s,.065*s,0xf8d66e,(.24+i*.12)*s,1.04*s,0,p);}animations.push(t=>{p.position.y=.17+Math.sin(t*1.5+x)*.035;p.rotation.y=Math.sin(t*.3+x)*.12;});return p;}
 function builder(x,z){const p=new T.Group();group.add(p);p.position.set(x,.03,z);p.rotation.y=-.6;box(.62,.68,.4,night?0x91a8ba:0x567e94,0,.8,0,p);box(.2,.34,.25,0x414f5d,-.17,.3,0,p);box(.2,.34,.25,0x414f5d,.17,.3,0,p);box(.28,.17,.42,0x654c45,-.17,.14,.07,p);box(.28,.17,.42,0x654c45,.17,.14,.07,p);if(block)box(.6,.54,.5,0xecc299,0,1.39,0,p);else ball(.33,0xecc299,0,1.4,0,p);cyl(.42,.42,.09,0xf0c35e,0,1.62,0,p,block?8:24);cyl(.31,.35,.24,0xf5cf70,0,1.76,0,p,block?8:24);box(.07,.08,.045,0x344348,-.12,1.42,.29,p);box(.07,.08,.045,0x344348,.12,1.42,.29,p);box(.2,.41,.22,0xecc299,-.42,.78,0,p);const arm=new T.Group();arm.position.set(.4,1.03,0);p.add(arm);box(.2,.46,.22,0xecc299,0,-.19,0,arm);rod([0,-.3,0],[0,-.3,.65],.045,0x826650,arm);box(.32,.16,.15,0x728783,0,-.3,.67,arm);box(.57,.29,.23,0x6b5b43,0,.74,-.3,p);animations.push(t=>{arm.rotation.x=Math.sin(t*3)*.45-.4;p.position.y=.03+Math.max(0,Math.sin(t*3))*.025;});return p;}
 function roof(x,z,w,d,h,y,c){const sh=new T.Shape();sh.moveTo(-w/2,0);sh.lineTo(w/2,0);sh.lineTo(0,h);sh.closePath();const ge=new T.ExtrudeGeometry(sh,{depth:d,bevelEnabled:false});return mesh(ge,c,x,y,z-d/2);}
 function house(x,z,s=1,c=0xecc7a4,rc=0xce806a){box(2.6*s,1.8*s,2.2*s,c,x,.9*s,z);roof(x,z,3*s,2.6*s,1.3*s,1.8*s,rc);box(.65*s,1.05*s,.06*s,0x749187,x-.5*s,.53*s,z+1.13*s);box(.7*s,.65*s,.07*s,night?0xf4cb81:0x9cc1c3,x+.62*s,1.13*s,z+1.14*s);box(.08*s,.67*s,.1*s,0xf0dfb5,x+.62*s,1.13*s,z+1.19*s);box(.73*s,.07*s,.1*s,0xf0dfb5,x+.62*s,1.13*s,z+1.19*s);box(.4*s,1.1*s,.45*s,0xc28f7b,x+.65*s,2.7*s,z-.35*s);if(night){const light=new T.PointLight(0xffb853,4,5,2);light.position.set(x+.6*s,1.2*s,z+1.5*s);group.add(light);}else{const smoke=[];for(let j=0;j<3;j++){const m=ball(.19+j*.07,0xf4efe2,x+.65*s,3.4*s+j*.43,z-.35*s);m.material=new T.MeshStandardMaterial({color:0xf4efe2,transparent:true,opacity:.5-j*.1});smoke.push(m);}animations.push(t=>smoke.forEach((m,j)=>{m.position.x=x+.65*s+Math.sin(t*.8+j)*.15;m.position.y=3.4*s+j*.43+Math.sin(t+j)*.08;}));}}
 function frogHouse(x,z){house(x,z,1.32,0xeed6a8,0x83ac82);for(const dx of [-1.02,1.02]){ball(.55,0x92bc8e,x+dx,4.03,z+.65);ball(.3,0xf2e9ce,x+dx,4.13,z+1.04);ball(.12,0x34594b,x+dx+.02,4.14,z+1.29);}label('FROG & FLOUR',x,1.91,z+1.51,2.5);for(let i=0;i<6;i++)box(.43,.12,.82,i%2?0xeed9b5:0xca947c,x-1.07+i*.43,1.69,z+1.84);box(2.6,.55,.1,0xa6b49a,x,.29,z+1.65);for(let i=0;i<5;i++)flower(x-1+i*.5,z+1.83,0xefac92,.6);}
 function mushroom(x,z,s=1,c=0xb3a3ce){cyl(.48*s,.65*s,1.8*s,0xdacfb4,x,.9*s,z);const cap=ball(1.2*s,c,x,1.85*s,z);cap.scale.set(1,.55,1);for(let a=0;a<5;a++){const t=a*1.9;ball(.15*s,0xe8dcca,x+Math.cos(t)*.65*s,2.24*s,z+Math.sin(t)*.65*s).scale.y=.35;}box(.35*s,.75*s,.06*s,0x665c68,x,.38*s,z+.54*s);mesh(new T.SphereGeometry(.15*s,12,8),0xf8c875,x+.27*s,1.13*s,z+.43*s,group,true);const l=new T.PointLight(0xf4b969,2.5,5*s,2);l.position.set(x,.8*s,z+.8*s);group.add(l);}
 function lantern(x,z,h=1.8){rod([x,0,z],[x,h,z],.04,0x6e736d);rod([x,h,z],[x+.4,h,z],.04,0x6e736d);cyl(.14,.14,.3,0xf7ce7d,x+.4,h-.2,z,group,8).material=mat(0xf7ce7d,true);cyl(.2,.16,.1,0x6e736d,x+.4,h-.4,z,group,8);cyl(.06,.21,.15,0x6e736d,x+.4,h+.02,z,group,8);const l=new T.PointLight(0xffc26a,3,6,2);l.position.set(x+.4,h-.25,z);group.add(l);}
 // A broad floating piece of terrain keeps the whole world readable in one frame.
 box(24,1.05,16,night?0x37585a:block?0x95795a:0xc0ae8e,0,-.7,0);
 box(24,.38,16,night?0x507c6f:block?0x86ad69:0xa6c69c,0,-.04,0);
 if(block){for(let i=0;i<12;i++){box(1.1,.5,.08,i%2?0xb4a078:0x796b4f,-11+i*2,-.8,8.05);}for(let i=0;i<6;i++)box(.08,.5,1.2,0xb2a078,12.05,-.8,-7+i*2.5);}
 // Diffuse studio floor, with a soft island shadow.
 const floor=mesh(new T.PlaneGeometry(300,300),bg,0,-1.28,0,scene);floor.rotation.x=-Math.PI/2;floor.castShadow=false;
 scene.add(new T.HemisphereLight(night?0x94b6dd:0xf6f2de,night?0x314346:0x8a9d84,night?1.45:2.2));
 const sun=new T.DirectionalLight(night?0xb6c9fa:0xfff0d2,night?2.0:2.6);sun.position.set(-12,25,10);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-22;sun.shadow.camera.right=22;sun.shadow.camera.top=20;sun.shadow.camera.bottom=-20;sun.shadow.normalBias=.035;sun.shadow.bias=-.0001;sun.shadow.radius=4;scene.add(sun);
 // Water curves around the village, crossed by a little pink bridge.
 const water=night?0x386e88:0x80c3cb;
 for(let z=-7;z<8;z+=1){let x=1.1+Math.sin(z*.4)*1.05;box(2.15,.06,1.1,water,x,.185,z);}
 if(!block){const pond=cyl(2.7,2.7,.08,water,4.0,.21,3.6,group,48);pond.scale.z=.78;}
 else box(5,.06,3.5,water,4,.21,3.5);
 for(let i=0;i<16;i++){const z=-6.7+i*.9,x=1+Math.sin(z*.4)*1.05;const ripple=box(.22+(i%3)*.17,.012,.045,night?0x7cafba:0xd4ece6,x+(i%2?-.5:.5),.237,z);animations.push(t=>{ripple.scale.x=1+Math.sin(t*1.4+i)*.25;});}
 // Winding paths and footbridge.
 const path=night?0x89988b:0xe3d7b6;
 for(let x=-10;x<11;x+=.8)box(.85,.045,1.05,path,x,.18,.8+Math.sin(x*.4)*.25);
 for(let z=-5.5;z<6;z+=.7)box(1,.045,.75,path,-5+Math.sin(z*.5)*.2,.18,z);
 const bridgeZ=1;
 for(let i=0;i<10;i++){let x=-.4+i*.34;box(.29,.14,1.35,night?0xb9a0b8:0xdc9f9c,x,.43+Math.sin(i/9*Math.PI)*.26,bridgeZ);}
 for(const zz of [bridgeZ-.65,bridgeZ+.65]){for(let i=0;i<4;i++)box(.12,.83,.12,night?0xc4aac9:0xe8b8ac,-.3+i*1.03,.68,zz);rod([-.4,1.12,zz],[2.85,1.12,zz],.055,night?0xc4aac9:0xe8b8ac);}
 // Back trees frame the buildings rather than obscure them.
 [[-10,-5,1.3],[-8.2,-6.2,.95],[-10.5,-2.5,.7],[9,-5.7,1.1],[10.6,-3.8,1.3],[7.1,-6.4,.85],[10.5,4.8,.8],[-10.8,4.7,.7]].forEach(([x,z,s],i)=>tree(x,z,s,i%2));
 for(let i=0;i<44;i++){const x=-10.8+(i*7.37%21.6),z=-6.8+(i*4.13%13.6);if(Math.abs(x-1)<2.2||Math.abs(z-1)<1||Math.abs(x+5)<1.2)continue;flower(x,z,night?0xc1b3df:i%3?0xf4de8c:0xf0b4a2,.5+(i%3)*.15);}
 if(style==='pocket'){
  frogHouse(-5,-3.7);house(7,-4.1,.88,0xe6b999,0x8899ae);
  fence(-9.6,-.8,3);fence(5.5,-1.8,3);
  bench(-8.2,3.3,.2);duck(4,3.3,1.35,true);duck(5.1,4.8,.65);
  // Tiny destination on the back hill.
  cyl(1.55,2,.7,0xb7c79a,3,-.02,-5,group,16);box(1.25,1.35,1.2,0xe7cf9d,3,1.01,-5);roof(3,-5,1.6,1.5,.9,1.69,0xd49a83);label('POST',3,1.3,-4.37,.8);
  // Work site: a miniature duck throne, with an unplaced crown ornament.
  box(2.5,.15,2.3,0xd6c2a0,6,.3,0);box(1.1,.45,.95,0xd2a563,6,.57,0);box(1.1,1.15,.18,0xd2a563,6,1.25,-.43);box(.9,.15,.8,0xe8a7a1,6,.87,.05);for(const x of [5.48,6.52])box(.16,.55,.9,0xefc87a,x,1.04,0);label('DUCK ONLY',6,1.41,-.31,.77);
  builder(7.6,1.55);box(.6,.4,.5,0xbf9870,8,.4,2.5);box(.75,.13,.4,0xe5c178,8.2,.69,2.4);
  // Flowers spilling out of a tiny wheelbarrow.
  box(.65,.3,.8,0x85a5a8,-6.8,.56,2.5);rod([-7,.5,2.8],[-7,.65,3.4],.04,0xb29271);rod([-6.6,.5,2.8],[-6.6,.65,3.4],.04,0xb29271);const wheel=cyl(.22,.22,.1,0x536a63,-6.8,.28,2.1,group,12);wheel.rotation.z=Math.PI/2;
 } else if(block){
  // Stepped terrain and geometric evergreens, with a square stream.
  box(5,1,3,0x769c5b,-7,.55,-5);box(3.2,.8,2,0x83ad65,-7.2,1.35,-5.5);tree(-8,-5.5,.9,1);
  house(-6,-1.9,1.25,0xefd398,0xc67860);label('BAKERY',-6,1.65,-.49,1.7);
  for(let i=0;i<4;i++){box(3.8-i*.9,.4,3.3,0xc67860,-6,2.48+i*.4,-1.9);}
  // Giant angular duck landmark, intentionally absurd against the tiny buildings.
  const d=duck(-7,4.4,2.1,true);d.rotation.y=.2;
  box(2.1,.25,1.3,0xb49875,-7,.3,4.4);label('OUR DUCK',-7,.52,5.09,1.4);
  // Castle under construction.
  box(4.5,.2,3.4,0xdac5a0,6,.27,-2);box(3.6,1.25,2.5,0xddd7c1,6,.97,-2);
  for(const x of [4.35,7.65])for(const z of [-3.1,-.9]){box(.95,2.6,.95,0xd4cfba,x,1.57,z);for(const dx of [-.28,.28])for(const dz of [-.28,.28])box(.35,.45,.35,0xe4dfcb,x+dx,3.08,z+dz);}
  box(.85,1.2,.1,0x7f8982,6,.87,-.72);box(.15,2,.15,0x8e8167,6,2.75,-2);box(.95,.6,.07,0xdd9f9b,6.47,3.3,-2);
  builder(6.5,1.6);for(let i=0;i<4;i++)box(.5,.3,.5,0xd8d1bc,8.5+(i%2)*.55,.34+Math.floor(i/2)*.3,1.7);
  fence(-10,1,3);bench(6.5,5.4);duck(4,3.8,.8);tree(8.5,3.5,.7);
  // Unfinished tower outline: explicit visual hint of the next pieces.
  const edges=new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(.95,.8,.95)),new T.LineBasicMaterial({color:0xf9f1c2,transparent:true,opacity:.75}));edges.position.set(7.65,3.55,-.9);group.add(edges);
 }else{
  mushroom(-5,-3,1.75,0xa694bc);mushroom(-8,-.8,.8,0xc4a0b0);mushroom(7,-4.3,1.15,0x8a9da9);
  bench(-6.4,2.5);duck(4,3.5,1,true);
  for(const [x,z] of [[-7.4,1.1],[-2.1,-2],[4.7,-.3],[8.4,3.6],[-7,5.2]])lantern(x,z);
  // Lantern bus shelter for ghosts.
  box(3.4,.15,2.2,0xa5a497,5.5,.27,-1.9);for(const x of [4.1,6.9])box(.13,2.2,.13,0xb4a17e,x,1.4,-2.65);box(3.3,.22,2.1,0x8797a1,5.5,2.53,-1.9);bench(5.5,-2.3);label('NIGHT BUS',5.5,2.49,-.8,1.8,'#dfd7b6','#3a5262');rod([7.65,0,-1.7],[7.65,2.2,-1.7],.06,0x9caa9b);box(.56,.64,.09,0xc9ba88,7.65,2,-1.7);label('B',7.65,2,-1.64,.35);
  function ghost(x,z,s){const p=new T.Group();p.position.set(x,.5,z);group.add(p);const dome=ball(.37*s,0xd0e6dc,0,.65*s,0,p);cyl(.36*s,.46*s,.52*s,0xd0e6dc,0,.4*s,0,p,18);for(const xx of [-.13,.13])ball(.04*s,0x425c65,xx*s,.71*s,.33*s,p);animations.push(t=>{p.position.y=.5+Math.sin(t*1.2+x)*.12;p.rotation.y=.2+Math.sin(t*.5+x)*.15;});}
  ghost(4.8,-.95,1);ghost(6,-.8,.75);builder(7.8,.75);
  // Floating light motes, not a distracting particle storm.
  for(let i=0;i<22;i++){const x=Math.sin(i*4.3)*10,z=Math.cos(i*2.7)*6,y=.7+(i%4)*.35;const m=mesh(new T.SphereGeometry(.035,6,4),0xf8da91,x,y,z,group,true);animations.push(t=>{m.position.y=y+Math.sin(t*.65+i)*.22;m.position.x=x+Math.sin(t*.3+i)*.15;});}
  // Tiny observatory dome with an angled telescope.
  cyl(1.1,1.1,1.3,0xbab6a1,-1, .83,-5.7);const dome=ball(1.2,0x8ea7aa,-1,1.65,-5.7);dome.scale.y=.7;rod([-1,1.8,-5.7],[-.2,2.65,-5.1],.14,0xcab99c);ball(.22,0xe6cf94,-.2,2.65,-5.1);
 }
 let yaw=.48,drag=null,visible=true,time=0;
 const target=new T.Vector3(0,.2,0);
 function resize(){const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
 function render(dt){if(!visible)return;if(!paused)time+=dt;const distance=camera.aspect<1.5?43:37;camera.position.set(Math.sin(yaw)*distance,27,Math.cos(yaw)*distance);camera.lookAt(target);animations.forEach(fn=>fn(time));renderer.render(scene,camera);}
 const obs=new ResizeObserver(resize);obs.observe(container);resize();
 const io=new IntersectionObserver(e=>{visible=e[0].isIntersecting;},{rootMargin:'200px'});io.observe(container);
 renderer.domElement.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;drag={x:e.clientX,yaw};renderer.domElement.setPointerCapture(e.pointerId);});
 renderer.domElement.addEventListener('pointermove',e=>{if(drag)yaw=Math.max(-.35,Math.min(1.25,drag.yaw+(e.clientX-drag.x)*.004));});
 renderer.domElement.addEventListener('pointerup',()=>drag=null);renderer.domElement.addEventListener('pointercancel',()=>drag=null);
 container.querySelector('.fallback').hidden=true;render(0);return {render};
}
for(const [id,style] of [['pocket','pocket'],['block','block'],['garden','garden']]){try{all.push(makeWorld(document.getElementById(id),style));}catch(e){const c=document.getElementById(id);c.querySelector('.fallback').textContent='This sample needs WebGL. Try opening it in a browser with hardware acceleration enabled.';console.error(e);}}
let last=0;function tick(now){const dt=last?Math.min((now-last)/1000,.05):0;last=now;all.forEach(w=>w.render(dt));requestAnimationFrame(tick);}requestAnimationFrame(tick);
})();