import {KEYS,LABELS,measure,average,assess,PersistenceGate} from './pose.js';
import {cameraError,openCamera,withTimeout} from './camera.js';
const $=id=>document.getElementById(id), video=$('video'),canvas=$('overlay'),ctx=canvas.getContext('2d');
function read(key,fallback){try{return JSON.parse(localStorage.getItem('bareun.'+key))??fallback;}catch{return fallback;}}
function save(key,value){try{localStorage.setItem('bareun.'+key,JSON.stringify(value));}catch{$('status').textContent='저장 공간을 사용할 수 없어 기록은 이번 화면에서만 유지됩니다.';}}
let baseline=read('baseline',null);if(!baseline||!Number.isFinite(baseline.shoulder))baseline=null;
let history=read('history',[]);if(!Array.isArray(history))history=[];
history=history.filter(s=>s&&Number.isFinite(s.score)&&Number.isFinite(s.duration)&&typeof s.date==='string'&&s.counts&&Array.isArray(s.buckets));
let detector,stream,session,calibration,lastResult,lastFrame=-1,lastInfer=0,raf,running=false,starting=false,generation=0,gate=new PersistenceGate(),lastNotice=0;
const advice={neck:'턱을 살짝 당기고 화면을 눈높이에 맞춰보세요.',shoulder:'양쪽 어깨에 힘을 빼고 높이를 편안하게 맞춰보세요.',torso:'골반을 세우고 몸의 중심을 의자 가운데로 옮겨보세요.',head:'고개를 가운데로 돌리고 귀와 어깨를 나란히 해보세요.'};
const setFeedback=(title,text,level='')=>{$('feedback').className='feedback '+level;$('feedback').querySelector('strong').textContent=title;$('feedback').querySelector('p').textContent=text;};
function renderMetrics(result){$('metrics').innerHTML=KEYS.map(key=>{const m=result?.metrics.find(v=>v.key===key);const hint=m?(key==='neck'?'어깨 폭 대비 깊이 변화 · 추정':baseline?'나의 기준 자세 대비 차이':'수평·수직 정렬 대비 차이'):!result?'카메라 연결 후 측정':key==='neck'&&!baseline?'기준 자세 등록 후 제공':key==='torso'?'골반이 보이면 측정':'해당 관절 인식 대기';return `<div class="metric ${m?.level||''}"><div class="metric-top">${LABELS[key]}<span class="pill">${m?{good:'안정',warn:'주의',bad:'교정 권장'}[m.level]:result?'미측정':'대기'}</span></div><div class="metric-value">${m?(key==='neck'?(m.delta*100).toFixed(0)+'%':Math.abs(m.delta).toFixed(1)+'°'):'—'}</div><small>${hint}</small></div>`;}).join('');}
function baselineUI(){$('baselineState').textContent=baseline?'등록 완료':'미등록';$('calibrate').textContent=baseline?'기준 자세 다시 등록 ＋':'기준 자세 등록 ＋';}
function dateKey(date){const d=new Date(date);return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;}
function renderHistory(){
  $('history').replaceChildren();
  if(!history.length)$('history').textContent='아직 기록이 없어요. 첫 세션을 시작해 보세요.';
  history.slice(0,4).forEach(s=>{const row=document.createElement('div');row.className='history-row';const t=document.createElement('span');t.textContent=new Date(s.date).toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});const b=document.createElement('button');b.textContent=`${s.score}점 · ${Math.round(s.duration/60)}분 ↗`;b.onclick=()=>showReport(s);row.append(t,b);$('history').append(row);});
  $('trend').replaceChildren();for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const day=history.filter(s=>dateKey(s.date)===dateKey(d));const avg=day.length?Math.round(day.reduce((a,s)=>a+s.score,0)/day.length):null;const c=document.createElement('div');c.className='bar-column';c.innerHTML=`<span>${avg??'—'}</span><div class="bar" style="height:${avg??2}%"></div><span>${d.getMonth()+1}/${d.getDate()}</span>`;$('trend').append(c);}
}
function showReport(s){const el=$('reportDetail');el.hidden=false;el.replaceChildren();const h=document.createElement('h3');h.textContent=`세션 리포트 · ${new Date(s.date).toLocaleString('ko-KR')}`;const p=document.createElement('p');p.textContent=`평균 ${s.score}점 · 세션 ${Math.round(s.duration)}초 · 유효 분석 ${s.samples}회`;el.append(h,p);const issues=document.createElement('p');issues.textContent=KEYS.map(k=>`${LABELS[k]} ${s.counts[k]||0}회`).join(' / ');el.append(issues);for(const minutes of [10,60]){const line=document.createElement('p');line.textContent=`${minutes}분 구간 평균: `+aggregate(s.buckets,minutes).map((b,i)=>`${i+1}구간 ${b}점`).join(' · ');el.append(line);}const sorted=KEYS.toSorted((a,b)=>(s.counts[b]||0)-(s.counts[a]||0));const rec=document.createElement('p');rec.textContent='다음 세션 추천: '+advice[sorted[0]];el.append(rec);}
function aggregate(buckets,minutes){const result=[];for(let i=0;i<buckets.length;i+=minutes){const group=buckets.slice(i,i+minutes).filter(Boolean);const count=group.reduce((s,v)=>s+v.count,0);result.push(count?Math.round(group.reduce((s,v)=>s+v.sum,0)/count):'—');}return result;}
async function getDetector(){if(detector)return detector;const {FilesetResolver,PoseLandmarker}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs');const files=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');const opts={baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'GPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.6,minPosePresenceConfidence:.6,minTrackingConfidence:.6};try{detector=await PoseLandmarker.createFromOptions(files,opts);}catch{opts.baseOptions.delegate='CPU';detector=await PoseLandmarker.createFromOptions(files,opts);}return detector;}
let modelLoading=false;
const retry=document.createElement('button');retry.className='secondary';retry.textContent='자세 분석 다시 시도';retry.hidden=true;$('stop').before(retry);
async function startAnalysis(token){
  if(modelLoading)return;modelLoading=token;retry.hidden=true;$('calibrate').disabled=true;
  $('status').textContent='카메라 연결됨 · 자세 분석 모델을 불러오는 중…';
  try{
    await withTimeout(getDetector(),30000,'모델 응답 시간이 초과되었습니다.');
    if(token!==generation||!running)return;
    $('calibrate').disabled=false;
    $('status').textContent='분석 준비 완료 · 얼굴과 양쪽 어깨를 보여주세요.';
    setFeedback('카메라와 자세 분석이 준비되었어요','인식되는 항목부터 바로 점수를 계산합니다. 기준 자세를 등록하면 개인 기준으로 비교해요.');
  }catch(error){
    if(token!==generation||!running)return;
    retry.hidden=false;
    $('status').textContent='카메라 연결됨 · 자세 분석 모델 로딩 실패';
    setFeedback('영상은 연결되었지만 자세 분석을 준비하지 못했어요',error.message+' 인터넷 연결 또는 회사 네트워크의 CDN 차단을 확인하고 다시 시도해 주세요.','warn');
  }finally{if(modelLoading===token)modelLoading=false;}
}
retry.onclick=()=>startAnalysis(generation);
$('start').onclick=async()=>{
  if(starting||running)return;
  starting=true;const token=++generation;$('start').disabled=true;$('stop').disabled=false;
  $('status').textContent='카메라 권한을 기다리고 있습니다. 브라우저 권한 요청을 확인해 주세요.';
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('브라우저가 카메라 API를 제공하지 않습니다. localhost 접속 또는 HTTP 전용 실행 스크립트를 이용해 주세요.');
    const acquired=await openCamera(navigator.mediaDevices);
    if(token!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
    stream=acquired;video.srcObject=stream;
    await withTimeout(video.play(),15000,'카메라 영상 재생 시간이 초과되었습니다.');
    if(token!==generation)return;
    running=true;$('placeholder').hidden=true;lastFrame=-1;lastInfer=0;lastResult=null;gate=new PersistenceGate();
    session={date:new Date().toISOString(),start:performance.now(),sum:0,samples:0,counts:Object.fromEntries(KEYS.map(k=>[k,0])),buckets:[],nextReset:25*60*1000};
    stream.getVideoTracks()[0].onended=()=>stop();
    raf=requestAnimationFrame(loop);
    await startAnalysis(token);
  }catch(error){
    if(token!==generation)return;
    stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;
    $('stop').disabled=true;
    const message=cameraError(error,window.isSecureContext);
    $('status').textContent=message;
    setFeedback('카메라 연결을 확인해 주세요',message,'warn');
  }finally{if(token===generation){starting=false;$('start').disabled=false;}}
};
function resetDisplay(){renderMetrics();$('score').textContent='—';$('scoreTitle').textContent='자세를 확인해 주세요';$('scoreDesc').textContent='얼굴과 양쪽 어깨가 보이도록 카메라를 조정하세요.';$('stage').className='stage';}
function draw(p,result){canvas.width=video.videoWidth;canvas.height=video.videoHeight;ctx.clearRect(0,0,canvas.width,canvas.height);if(!p)return;const color=k=>({good:'#7dd4b4',warn:'#f0c76b',bad:'#f18b7b'}[result?.metrics.find(m=>m.key===k)?.level]||'#99cdb6');const edges=[[7,8,'head'],[11,12,'shoulder'],[11,23,'torso'],[12,24,'torso'],[23,24,'torso'],[11,13,'shoulder'],[13,15,'shoulder'],[12,14,'shoulder'],[14,16,'shoulder'],[7,11,'neck'],[8,12,'neck'],[23,25,'torso'],[25,27,'torso'],[24,26,'torso'],[26,28,'torso']];ctx.lineWidth=3;for(const[a,b,k]of edges){if(p[a].visibility<.65||p[b].visibility<.65)continue;ctx.strokeStyle=color(k);ctx.beginPath();ctx.moveTo(p[a].x*canvas.width,p[a].y*canvas.height);ctx.lineTo(p[b].x*canvas.width,p[b].y*canvas.height);ctx.stroke();}for(const v of p){if(v.visibility<.65)continue;ctx.fillStyle='#d7f3de';ctx.beginPath();ctx.arc(v.x*canvas.width,v.y*canvas.height,4,0,Math.PI*2);ctx.fill();}}
function notify(title,text){const today=dateKey(new Date());let count=read('notifications',{day:today,count:0});if(count.day!==today)count={day:today,count:0};if(count.count>=Number($('cap').value)||Date.now()-lastNotice<30000)return;count.count++;lastNotice=Date.now();save('notifications',count);if(!$('focus').checked&&'Notification'in window&&Notification.permission==='granted')new Notification(title,{body:text});}
function processPose(p,now){const m=measure(p,video.videoWidth/video.videoHeight);if(!m){gate=new PersistenceGate();if(calibration){calibration.previous=null;$('calibrationText').textContent='인식 대기 · 양쪽 어깨를 보여주세요';}lastResult=null;resetDisplay();draw(p);$('status').textContent=p?'양쪽 어깨 인식 대기 · 어깨가 화면 안에 보이도록 거리를 조절해 주세요.':'사람 인식 대기 · 얼굴과 양쪽 어깨를 카메라에 보여주세요.';setFeedback('카메라 위치를 조정해 주세요','밝은 곳에서 양쪽 어깨가 모두 보이도록 촬영해 주세요. 골반이 없어도 어깨와 고개를 분석할 수 있어요.');return;}
  if(calibration){if(calibration.previous!=null)calibration.elapsed+=Math.min(now-calibration.previous,250);calibration.previous=now;calibration.samples.push(m);$('progress').value=calibration.elapsed/1000;$('calibrationText').textContent=`편안한 바른 자세를 유지하세요 · ${Math.max(0,20-Math.floor(calibration.elapsed/1000))}초`;if(calibration.elapsed>=20000){baseline=average(calibration.samples);save('baseline',baseline);calibration=null;$('calibration').hidden=true;$('calibrate').disabled=false;baselineUI();gate=new PersistenceGate();setFeedback('나의 기준 자세가 등록되었어요','지금부터 기준 자세와의 차이를 살펴볼게요.');}}
  if(calibration){draw(p);$('status').textContent='기준 자세를 측정하고 있습니다.';return;}
  const result=assess(m,baseline);lastResult=result;draw(p,result);renderMetrics(result);$('score').textContent=result.score??'—';$('scoreTitle').textContent=result.score>=80?'편안한 자세예요':result.score>=60?'조금만 다듬어 볼까요?':'잠깐, 자세를 리셋해요';$('scoreDesc').textContent=(baseline?'개인 기준 대비':'일반 정렬 참고')+' · '+result.metrics.length+'개 항목 분석';
  if(result.score===null)return;
  session.sum+=result.score;session.samples++;const minute=Math.floor((now-session.start)/60000);session.buckets[minute]??={sum:0,count:0};session.buckets[minute].sum+=result.score;session.buckets[minute].count++;
  const issues=result.metrics.filter(v=>v.level!=='good');const triggered=gate.update(issues.map(v=>v.key),now);for(const k of triggered){session.counts[k]++;notify(LABELS[k]+' 자세 확인',advice[k]);}
  const persistent=issues.filter(v=>gate.active.has(v.key)).sort((a,b)=>b.ratio-a.ratio);if(persistent.length){const issue=persistent[0];$('stage').className='stage '+issue.level;setFeedback(LABELS[issue.key]+' · 5초 이상 변화가 지속돼요',advice[issue.key],issue.level);}else{$('stage').className='stage';setFeedback('좋아요, 편안하게 호흡하세요','자세 변화가 5초 이상 이어질 때 교정 안내를 드립니다.');}
  $('status').textContent=`분석 중 · ${result.metrics.length}/4개 항목 · ${baseline?'개인 기준':'일반 정렬 기준'}${m.torso===null?' · 골반 미인식: 상체 제외':''}${!baseline?' · 목 지표는 기준 등록 후 제공':''}`;
}
function loop(now){if(!running)return;const elapsed=now-session.start;$('timer').textContent=`${String(Math.floor(elapsed/60000)).padStart(2,'0')}:${String(Math.floor(elapsed/1000)%60).padStart(2,'0')}`;try{if(detector&&!modelLoading&&retry.hidden&&video.readyState>=2&&video.currentTime!==lastFrame&&now-lastInfer>=100){lastFrame=video.currentTime;lastInfer=now;const r=detector.detectForVideo(video,now);processPose(r.landmarks[0],now);}if(elapsed>=session.nextReset){session.nextReset+=25*60*1000;setFeedback('25분이 지났어요. 잠깐 자세를 리셋해요.','아래 1분 리셋 가이드와 함께 어깨를 편안하게 풀어주세요.');notify('자세 리셋 시간','잠시 일어나 목과 어깨를 풀어보세요.');}}catch(e){stop();$('status').textContent='분석이 중단되었습니다. 카메라를 다시 켜 주세요. '+e.message;return;}raf=requestAnimationFrame(loop);}
function stop(){if(!running&&!starting)return;generation++;modelLoading=false;running=false;starting=false;retry.hidden=true;$('start').disabled=false;cancelAnimationFrame(raf);stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;calibration=null;$('calibration').hidden=true;ctx.clearRect(0,0,canvas.width,canvas.height);$('placeholder').hidden=false;$('stop').disabled=true;$('calibrate').disabled=true;$('stage').className='stage';if(session?.samples){const record={date:session.date,duration:(performance.now()-session.start)/1000,score:Math.round(session.sum/session.samples),samples:session.samples,counts:session.counts,buckets:session.buckets};history.unshift(record);history=history.slice(0,200);save('history',history);renderHistory();showReport(record);setFeedback('오늘의 기록이 저장되었어요',`평균 ${record.score}점 · 아래 세션 리포트에서 변화와 추천을 확인하세요.`);}else{setFeedback('세션이 종료되었어요','기준 자세 등록 후 유효한 분석이 있어야 리포트가 저장됩니다.');}session=null;resetDisplay();$('status').textContent='세션 종료 · 카메라 꺼짐';}
$('stop').onclick=stop;
$('calibrate').onclick=()=>{if(!running)return;calibration={samples:[],elapsed:0,previous:null};gate=new PersistenceGate();resetDisplay();$('calibrate').disabled=true;$('calibration').hidden=false;$('calibrationText').textContent='자세를 찾고 있습니다…';$('progress').value=0;setFeedback('기준 자세를 등록하고 있어요','몸을 정면으로 두고 어깨 힘을 뺀 상태로 20초 유지해 주세요.');};
$('settingsToggle').onclick=()=>{$('settings').hidden=!$('settings').hidden;};
const settings=read('settings',{focus:true,cap:10});$('focus').checked=settings.focus!==false;$('cap').value=Number.isFinite(settings.cap)?Math.max(0,Math.min(100,settings.cap)):10;
for(const id of ['focus','cap'])$(id).onchange=()=>{$('cap').value=Math.max(0,Math.min(100,Math.round(Number($('cap').value)||0)));save('settings',{focus:$('focus').checked,cap:Number($('cap').value)});};
$('notification').onclick=async()=>{if(!('Notification'in window)){$('notification').textContent='이 브라우저는 알림을 지원하지 않아요';return;}try{$('notification').textContent=(await Notification.requestPermission())==='granted'?'알림 허용됨':'알림 권한이 허용되지 않았어요';}catch{$('notification').textContent='알림 권한을 요청할 수 없어요';}};
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,baseline,sessions:history},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='bareun-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('clear').onclick=()=>{if(!confirm('저장된 세션 기록을 모두 삭제할까요? 기준 자세는 유지됩니다.'))return;history=[];save('history',history);$('reportDetail').hidden=true;renderHistory();};
let stretchInterval,stretchStart;
$('stretch').onclick=()=>{if(stretchInterval){clearInterval(stretchInterval);stretchInterval=null;$('stretch').textContent='1분 리셋 시작 ↗';return;}stretchStart=Date.now();const tick=()=>{const elapsed=Math.floor((Date.now()-stretchStart)/1000);if(elapsed>=60){clearInterval(stretchInterval);stretchInterval=null;$('stretch').textContent='1분 리셋 시작 ↗';setFeedback('리셋 완료, 다시 가볍게 시작해요','편안한 자세로 돌아와 천천히 호흡하세요.');return;}$('stretch').textContent=`${['턱 가볍게 당기기','어깨 뒤로 열기','가슴 펴고 호흡하기'][Math.floor(elapsed/20)]} · ${60-elapsed}초 (중지)`;};stretchInterval=setInterval(tick,250);tick();};
document.addEventListener('visibilitychange',()=>{if(document.hidden){gate=new PersistenceGate();if(calibration)calibration.previous=null;}});
window.addEventListener('pagehide',stop);
renderMetrics();baselineUI();renderHistory();
$('scoreTitle').textContent='카메라를 켜면 바로 분석';
$('scoreDesc').textContent='기준 등록 전에는 일반 정렬 참고 점수를 표시합니다.';
$('placeholder').querySelector('p').textContent='얼굴과 양쪽 어깨가 보이도록 앉아주세요. 인식되는 항목부터 점수를 계산합니다.';
