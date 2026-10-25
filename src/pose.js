export const KEYS=['neck','shoulder','torso','head'];
export const LABELS={neck:'목 전방 이동',shoulder:'어깨 균형',torso:'상체 기울기',head:'고개 균형'};
export function measure(p,aspect=1){
  const visible=i=>p?.[i]&&(p[i].visibility??0)>.65&&p[i].x>=0&&p[i].x<=1&&p[i].y>=0&&p[i].y<=1&&Number.isFinite(p[i].z);
  if(![11,12].every(visible))return null;
  const q=p.map(v=>({...v,x:v.x*aspect,z:v.z*aspect}));
  const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2});
  const s=mid(q[11],q[12]);
  const width=Math.hypot(q[11].x-q[12].x,q[11].y-q[12].y);
  if(width<.05)return null;
  const tilt=(a,b)=>Math.atan2(a.y-b.y,Math.abs(a.x-b.x))*180/Math.PI;
  const ears=[7,8].every(visible),hips=[23,24].every(visible);
  const e=ears?mid(q[7],q[8]):null,h=hips?mid(q[23],q[24]):null;
  return {neck:e?(s.z-e.z)/width:null,shoulder:tilt(q[11],q[12]),torso:h?Math.atan2(s.x-h.x,h.y-s.y)*180/Math.PI:null,head:e?tilt(q[7],q[8]):null};
}
export function average(samples){return Object.fromEntries(KEYS.map(k=>{const values=samples.map(v=>v[k]).filter(Number.isFinite);return [k,values.length?values.reduce((a,b)=>a+b,0)/values.length:null];}));}
export function assess(m,b=null){
  const reference=b??{neck:null,shoulder:0,torso:0,head:0};
  const limits={neck:.18,shoulder:5,torso:8,head:6};
  const metrics=KEYS.filter(key=>Number.isFinite(m[key])&&Number.isFinite(reference[key])).map(key=>{const delta=m[key]-reference[key]; const ratio=(key==='neck'?Math.max(0,delta):Math.abs(delta))/limits[key];return {key,delta,ratio,level:ratio>=1.8?'bad':ratio>=1?'warn':'good'};});
  return {metrics,score:metrics.length?Math.round(Math.max(0,100-metrics.reduce((s,v)=>s+Math.min(25,v.ratio*12),0)*4/metrics.length)):null};
}
export class PersistenceGate {
  constructor(delay=5000){this.delay=delay;this.starts={};this.active=new Set();}
  update(keys,now){const triggered=[];for(const key of Object.keys(this.starts))if(!keys.includes(key)){delete this.starts[key];this.active.delete(key);}for(const key of keys){this.starts[key]??=now;if(now-this.starts[key]>=this.delay&&!this.active.has(key)){this.active.add(key);triggered.push(key);}}return triggered;}
}
