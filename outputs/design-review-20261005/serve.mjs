import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url);
const files={'/':['index.html','text/html; charset=utf-8'],'/design.css':['design.css','text/css; charset=utf-8'],'/design.mjs':['design.mjs','text/javascript; charset=utf-8'],'/arabic.woff2':['arabic.woff2','font/woff2']};
createServer(async(req,res)=>{const entry=files[new URL(req.url,'http://localhost').pathname];if(!entry){res.writeHead(404);res.end();return;}try{const data=await readFile(fileURLToPath(new URL(entry[0],root)));res.writeHead(200,{'Content-Type':entry[1],'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'",'X-Content-Type-Options':'nosniff'});res.end(data);}catch{res.writeHead(500);res.end();}}).listen(3615,'127.0.0.1',()=>console.log('Design preview: http://127.0.0.1:3615/'));
