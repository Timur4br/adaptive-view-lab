'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const port=Number(process.env.PORT||4173);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT must be an integer from 1024 to 65535');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.md':'text/plain; charset=utf-8','.csv':'text/csv; charset=utf-8','.cff':'text/plain; charset=utf-8'};
const server=http.createServer((req,res)=>{
 let pathname;
 try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400);res.end('Bad request');return;}
 const parts=pathname.split('/');
 if(parts.some(p=>p.startsWith('.'))){res.writeHead(403);res.end('Forbidden');return;}
 let filename=path.resolve(root,'.'+pathname);
 if(filename!==root&&!filename.startsWith(root+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
 fs.stat(filename,(err,stat)=>{
  if(!err&&stat.isDirectory())filename=path.join(filename,'index.html');
  fs.readFile(filename,(err,data)=>{
   if(err){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');return;}
   res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(data);
  });
 });
});
server.listen(port,'127.0.0.1',()=>console.log(`Ракурс: http://127.0.0.1:${port}\nОстановка: Ctrl+C`));
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
process.on('SIGINT',()=>server.close());process.on('SIGTERM',()=>server.close());
