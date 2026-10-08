// Exact DOM/CSS/SVG reference screenshots; all resources are served from this repo over loopback HTTP.
import {chromium} from 'playwright-core';import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');const ui=path.join(repo,'docs/refs/ui');
const server=http.createServer((req,res)=>{const p=path.resolve(repo,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(repo+'/')){res.writeHead(403).end();return;}res.setHeader('Content-Type',{'.html':'text/html','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'}[path.extname(p)]||'text/plain');const stream=fs.createReadStream(p);stream.on('error',()=>res.writeHead(404).end());stream.pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.SNAP_CHROME||'/usr/bin/chromium',args:['--no-sandbox']});const results=[];
for(const file of fs.readdirSync(path.join(ui,'mockups')).filter(x=>x.endsWith('.html')).sort()){
 const name=file.slice(0,-5);const [width,height]=name==='hud_touch'?[844,390]:name==='logo_preview'?[1536,1024]:[1920,1080];const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().includes('favicon'))errors.push(r.url()+' '+r.status());});
 await page.goto(base+'/docs/refs/ui/mockups/'+file);await page.evaluate(()=>document.fonts.ready);
 let out=path.join(ui,name+'.jpg');if(name==='icons_preview')out=path.join(ui,'icons/icons_preview.jpg');if(name==='logo_preview')out=path.join(ui,'logo/logo_preview.jpg');
 await page.screenshot({path:out,type:'jpeg',quality:88});const measured=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-ref]')).map(e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return {element:e.dataset.ref,rect_px:[r.x,r.y,r.width,r.height],rect_percent:[r.x/innerWidth*100,r.y/innerHeight*100,r.width/innerWidth*100,r.height/innerHeight*100],font_family:s.fontFamily,font_px:parseFloat(s.fontSize)};}));
 results.push({source:'measured_script',screen:name,viewport_px:[width,height],jpeg_quality:88,errors,elements:measured});await page.close();
}
await browser.close();server.close();fs.writeFileSync(path.join(ui,'mockup-measurements.json'),JSON.stringify({source:'measured_script',script:'tools/render_ui.mjs',screens:results},null,2)+'\n');console.log(JSON.stringify({screens:results.length,errors:results.flatMap(x=>x.errors)}));if(results.some(x=>x.errors.length))process.exitCode=1;
