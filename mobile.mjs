import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT)||5173;
const local=`http://127.0.0.1:${port}`;
let server,tunnel;
let stopping=false;
function cleanup(){if(stopping)return;stopping=true;tunnel?.kill();server?.kill();}
process.on('SIGINT',()=>{cleanup();process.exit(0);});
process.on('SIGTERM',()=>{cleanup();process.exit(0);});
process.on('exit',cleanup);
async function download(){
  const asset=process.platform==='win32'?'cloudflared-windows-amd64.exe':process.platform==='linux'?(process.arch==='arm64'?'cloudflared-linux-arm64':'cloudflared-linux-amd64'):null;
  if(!asset||!['x64','arm64'].includes(process.arch)||process.platform==='win32'&&process.arch!=='x64')throw new Error('This helper supports Windows x64 and Linux x64/arm64.');
  console.log('Checking official cloudflared release…');
  const release=await fetch('https://api.github.com/repos/cloudflare/cloudflared/releases/latest',{signal:AbortSignal.timeout(30000),headers:{'User-Agent':'position-coach'}});
  if(!release.ok)throw new Error(`Release lookup failed: HTTP ${release.status}`);
  const info=await release.json(),entry=info.assets.find(a=>a.name===asset);
  if(!entry||!/^sha256:[0-9a-f]{64}$/i.test(entry.digest||''))throw new Error('Official release has no verifiable SHA256 digest.');
  const dir=join(root,'.tools',info.tag_name);await mkdir(dir,{recursive:true});
  const path=join(dir,asset),expected=entry.digest.slice(7);
  const valid=bytes=>createHash('sha256').update(bytes).digest('hex')===expected;
  try{if(valid(await readFile(path)))return path;}catch{}
  console.log(`Downloading ${asset} (${info.tag_name})…`);
  const response=await fetch(entry.browser_download_url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw new Error(`Download failed: HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!valid(bytes))throw new Error('SHA256 verification failed.');
  await writeFile(path,bytes);if(process.platform!=='win32')await chmod(path,0o755);
  console.log('Official binary SHA256 verified.');return path;
}
async function ready(){try{const r=await fetch(local,{signal:AbortSignal.timeout(1000)});return r.ok&&(await r.text()).includes('src/app.js');}catch{return false;}}
try{
  const binary=await download();
  if(process.argv.includes('--prepare-only')){console.log('Prepared:',binary);process.exit(0);}
  if(!await ready()){
    server=spawn(process.execPath,['server.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});
    let failure;server.on('error',e=>failure=e);server.on('exit',code=>{if(!stopping)failure=new Error(`Server exited (${code}). Port ${port} may already be occupied.`);});
    for(let i=0;i<40;i++){if(failure)throw failure;if(await ready())break;await new Promise(r=>setTimeout(r,250));}
    if(!await ready())throw failure||new Error('Local server did not start.');
  }
  console.log('\nStarting temporary PUBLIC HTTPS access to this app.');
  console.log('Open the https://….trycloudflare.com URL below in phone Safari/Chrome.');
  console.log('Allow camera permission. Keep this terminal open; Ctrl+C closes the tunnel.');
  console.log('Video stays on the phone. A new tunnel URL has separate browser history/baseline.\n');
  tunnel=spawn(binary,['tunnel','--no-autoupdate','--protocol','http2','--url',local],{cwd:root,stdio:'inherit',windowsHide:true});
  tunnel.on('error',e=>{console.error(e.message);cleanup();process.exitCode=1;});
  tunnel.on('exit',code=>{cleanup();process.exitCode=code||0;});
}catch(error){console.error(error.message);cleanup();process.exitCode=1;}
