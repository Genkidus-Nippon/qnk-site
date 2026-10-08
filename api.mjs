import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {CATEGORIES,GRADES,phase} from './config.mjs';

const SESSION_MS=12*60*60*1000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new HttpError(status,message);};
function text(value,max,label) {
  if(typeof value!=='string' || !value.trim() || value.trim().length>max) fail(400,`${label}を確認してください。`);
  return value.trim();
}
function category(value) {if(!CATEGORIES.includes(value))fail(400,'質問・提言の種類を確認してください。');return value;}
function prune(data,now){data.sessions=data.sessions.filter(s=>s.expiresAt>now);}
async function body(req) {
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))fail(415,'送信形式を確認してください。');
  let size=0,chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>70_000)fail(413,'入力が長すぎます。');chunks.push(chunk);}
  try {const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data || typeof data!=='object' || Array.isArray(data))throw new Error();return data;}
  catch{fail(400,'入力内容を確認してください。');}
}

export function createApp({store,config,publicDir,now=Date.now}) {
  const credential=createHmac('sha256',config.sessionSecret).update(`${config.adminEmail.toLowerCase()}\0${config.adminPassword}`).digest('hex');
  const cookieName=config.production?'__Host-qnk-session':'qnk-session';
  const signature=token=>createHmac('sha256',config.sessionSecret).update(token).digest('base64url');
  const cookie=(value,maxAge)=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.production?'; Secure':''}`;
  const limits=new Map();
  function rate(key,max,windowMs){
    const time=now();
    for(const [k,v] of limits)if(v.end<=time)limits.delete(k);
    const value=limits.get(key)||{count:0,end:time+windowMs};
    if(value.count>=max)fail(429,'操作が多すぎます。少し待って再試行してください。');
    value.count++;limits.set(key,value);
  }
  function token(req){
    const encoded=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
    if(!encoded)return null;
    const [value,sig,...extra]=encoded.split('.');
    if(extra.length || !/^[A-Za-z0-9_-]{43}$/.test(value||'') || !sig || !equal(signature(value),sig))return null;
    return value;
  }
  async function admin(req,required=true){
    const value=token(req);
    if(value){const {data}=await store.read();if(data.sessions.some(s=>s.hash===hash(value)&&s.expiresAt>now()&&s.credential===credential))return true;}
    if(required)fail(401,'木原としてログインしてください。');
    return false;
  }
  function json(res,status,data,headers={}) {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));
  }
  return async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url=new URL(req.url,'http://localhost');
      const path=url.pathname;
      if(req.method==='POST') {
        const expected=config.appUrl || (config.production?'':`http://${req.headers.host}`);
        if(!expected || req.headers.origin!==new URL(expected).origin)fail(403,'サイトを開き直してから送信してください。');
      }
      if(path==='/healthz' && req.method==='GET'){json(res,200,{ok:true});return;}
      if(path==='/api/auth/me' && req.method==='GET'){json(res,200,{admin:await admin(req,false)});return;}
      const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').toString().split(',').at(-1).trim();
      if(path==='/api/auth/login' && req.method==='POST') {
        rate(`login:${ip}`,8,15*60*1000);
        const input=await body(req);
        const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
        const password=typeof input.password==='string'?input.password:'';
        const correctEmail=equal(email,config.adminEmail.toLowerCase());
        const correctPassword=equal(password,config.adminPassword);
        if(!correctEmail || !correctPassword)fail(401,'メールアドレスとパスワードを確認してください。');
        const value=randomBytes(32).toString('base64url'),createdAt=now();
        rate('writes',30,60_000);rate('writes-hour',300,60*60_000);
        await store.mutate(data=>{prune(data,createdAt);data.sessions.push({hash:hash(value),credential,expiresAt:createdAt+SESSION_MS});data.sessions=data.sessions.slice(-20);});
        json(res,200,{ok:true},{'Set-Cookie':cookie(`${value}.${signature(value)}`,SESSION_MS/1000)});return;
      }
      if(path==='/api/auth/logout' && req.method==='POST') {
        const value=token(req);
        if(value){rate('writes',30,60_000);rate('writes-hour',300,60*60_000);await store.mutate(data=>{prune(data,now());data.sessions=data.sessions.filter(s=>s.hash!==hash(value));});}
        json(res,200,{ok:true},{'Set-Cookie':cookie('',0)});return;
      }
      if(path==='/api/state' && req.method==='GET') {
        const {data}=await store.read();const time=now(),edition=phase(time);
        const affiliation={ICX:0,OGX:0},grade=Object.fromEntries(GRADES.map(g=>[g,0]));
        for(const q of data.questions){affiliation[q.affiliation]++;grade[q.grade]++;}
        json(res,200,{now:time,edition,url:edition?(data.editions[edition]||''):'',total:data.questions.length,affiliation,grade});return;
      }
      if(path==='/api/answers' && req.method==='GET') {
        if(!phase(now())){json(res,200,{answers:[]});return;}
        const {data}=await store.read();
        json(res,200,{answers:data.answers.map(a=>({id:a.id,category:a.category,question:a.question,answer:a.answer,publishedAt:a.publishedAt})).sort((a,b)=>b.publishedAt-a.publishedAt)});return;
      }
      if(path==='/api/questions' && req.method==='POST') {
        if(!phase(now()))fail(403,'質問・提言の受付は終了しました。');
        rate(`question:${ip}`,10,10*60_000);rate('writes',30,60_000);rate('writes-hour',300,60*60_000);
        const input=await body(req);
        if(typeof input.id!=='string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.id))fail(400,'送信IDを確認してください。');
        if(!['ICX','OGX'].includes(input.affiliation)||!GRADES.includes(input.grade))fail(400,'所属と学年を確認してください。');
        const q={id:input.id,name:text(input.name,100,'名前'),affiliation:input.affiliation,grade:input.grade,category:category(input.category),question:text(input.question,5000,'質問・提言'),created_at:now()};
        await store.mutate(data=>{
          // 受付終了直前に待ち行列へ入ったリクエストも、保存時に再判定。
          if(!phase(now()))fail(403,'質問・提言の受付は終了しました。');
          const existing=data.questions.find(x=>x.id===q.id);
          if(existing){for(const key of ['name','affiliation','grade','category','question'])if(existing[key]!==q[key])fail(409,'送信IDが重複しています。ページを開き直してください。');return;}
          prune(data,now());data.questions.push(q);
        });
        json(res,200,{ok:true});return;
      }
      if(path==='/api/admin') {
        await admin(req);
        if(req.method==='GET') {
          const {data}=await store.read();
          json(res,200,{questions:data.questions.map(q=>{const a=data.answers.find(x=>x.questionId===q.id);return {...q,answer:a?.answer||'',publicQuestion:a?.question||''};}).sort((a,b)=>b.created_at-a.created_at),editions:[1,2,3].map(id=>({id,url:data.editions[id]||''}))});return;
        }
        if(req.method==='POST') {
          rate('writes',30,60_000);rate('writes-hour',300,60*60_000);
          const input=await body(req),time=now();
          if(input.action==='edition') {
            if(![1,2,3].includes(input.edition)||typeof input.url!=='string'||input.url.length>2000)fail(400,'資料のURLを確認してください。');
            const value=input.url.trim();
            if(value){let target;try{target=new URL(value);}catch{fail(400,'資料のURLを確認してください。');}if(target.protocol!=='https:'||target.username||target.password)fail(400,'資料のURLにはhttpsを使用してください。');}
            await store.mutate(data=>{prune(data,time);data.editions[input.edition]=value;});
          } else if(['answer','external'].includes(input.action)) {
            const answer={id:randomUUID(),questionId:input.action==='answer'?input.questionId:null,category:category(input.category),question:text(input.question,5000,'公開する質問・提言'),answer:text(input.answer,10000,'回答'),publishedAt:time};
            await store.mutate(data=>{
              if(input.action==='answer'&&!data.questions.some(q=>q.id===answer.questionId))fail(404,'質問・提言が見つかりません。');
              prune(data,time);
              const index=answer.questionId?data.answers.findIndex(a=>a.questionId===answer.questionId):-1;
              if(index>=0)data.answers[index]={...answer,id:data.answers[index].id};else data.answers.push(answer);
            });
          } else fail(400,'操作を確認してください。');
          json(res,200,{ok:true});return;
        }
      }
      if(path.startsWith('/api/'))fail(404,'ページが見つかりません。');
      if(!['GET','HEAD'].includes(req.method))fail(405,'操作を確認してください。');
      const files={'/':['index.html','text/html; charset=utf-8'],'/index.html':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/favicon.svg':['favicon.svg','image/svg+xml'],'/kihara.jpg':['kihara.jpg','image/jpeg']};
      const entry=files[path];if(!entry)fail(404,'ページが見つかりません。');
      const content=await readFile(new URL(entry[0],publicDir));
      res.writeHead(200,{'Content-Type':entry[1],'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);
    } catch(error) {
      const status=error instanceof HttpError?error.status:503;
      // 外部サービスのレスポンスや環境変数をログ・画面へ出さない。
      json(res,status,{error:error instanceof HttpError?error.message:'保存先に接続できません。少し待って再試行してください。'});
    }
  };
}
