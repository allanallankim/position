import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
const root=resolve('.');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
http.createServer(async(req,res)=>{
  try {
    const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url,'http://localhost').pathname));
    if(!path.startsWith(root+sep)||!['.html','.js','.css'].includes(extname(path))) {res.writeHead(403).end();return;}
    const data=await readFile(path); res.writeHead(200,{'Content-Type':types[extname(path)],'X-Content-Type-Options':'nosniff'}).end(data);
  } catch {res.writeHead(404).end('Not found');}
}).listen(Number(process.env.PORT)||5173,'0.0.0.0',()=>console.log('Position Coach: http://localhost:'+(process.env.PORT||5173)));
