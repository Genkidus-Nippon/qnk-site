// QnK：相対インポートなしで起動するサーバー統合版。
// 固定日時・GitHub保存・認証・APIをこのファイルに含める。
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

// ----- config.mjs -----
export const CATEGORIES = Object.freeze(['Summary','Vision＆Misson','Goal＆Isse','Direction Analysis','Current Anlysis','Strategy','Personality','Appendix','もろもろ']);
export const GRADES = Object.freeze(['1年','2年','3年','4年','大学院','その他']);
export const FIRST_URL = 'https://drive.google.com/file/d/1o19JfD3iWelpRjefFSz7JlY-iQ7SeVdX/view?usp=drive_link';
export const SCHEDULE = Object.freeze({
  second: Date.parse('2026-10-20T12:00:00+09:00'),
  third: Date.parse('2026-11-03T12:00:00+09:00'),
  end: Date.parse('2026-11-09T00:00:00+09:00'),
});
export function phase(now) { return now >= SCHEDULE.end ? 0 : now >= SCHEDULE.third ? 3 : now >= SCHEDULE.second ? 2 : 1; }
export function editionLabel(n) { return ['', '第一版', '第二版', '第三版'][n]; }
export function emptyData() { return {version:1, questions:[], answers:[], editions:{1:FIRST_URL,2:'',3:''}, sessions:[]}; }

// ----- github-store.mjs -----
// 個人情報を含むため、保存先は非公開リポジトリに限定する。
export class GitHubStore {
  constructor({token, owner, repo, branch='main', dataPath='qnk/data.json', fetchImpl=fetch, cacheMs=10_000}) {
    if (!token || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(owner || '') || !/^[A-Za-z0-9_.-]+$/.test(repo || '')) throw new Error('GitHubの保存先設定を確認してください。');
    if (!branch || !dataPath || dataPath.startsWith('/') || dataPath.split('/').some(x=>!x || x==='.' || x==='..')) throw new Error('GitHubの保存先パスを確認してください。');
    this.token=token; this.branch=branch; this.fetch=fetchImpl; this.cacheMs=cacheMs;
    this.base=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    this.contents=`${this.base}/contents/${dataPath.split('/').map(encodeURIComponent).join('/')}`;
    this.cached=null; this.cachedAt=0; this.pending=null; this.queue=Promise.resolve();
  }
  async request(url, options={}) {
    try {
      return await this.fetch(url, {...options, signal:AbortSignal.timeout(20_000), headers:{
        Accept:'application/vnd.github+json', Authorization:`Bearer ${this.token}`,
        'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'QnK',
        ...(options.body ? {'Content-Type':'application/json'} : {}), ...options.headers,
      }});
    } catch { throw new Error('GitHubの保存先と通信できません。少し待って再試行してください。'); }
  }
  async assertPrivate() {
    const response=await this.request(this.base);
    if (!response.ok) {
      // GitHubの本文には設定値が含まれる可能性があるため、HTTP番号のみで案内する。
      const status=response.status;
      if(status===401)throw new Error('GitHub認証エラー（HTTP 401）：GITHUB_TOKENを確認してください。トークンの無効・期限切れ・入力時の空白や引用符が原因の可能性があります。');
      if(status===404)throw new Error('GitHub保存先の確認エラー（HTTP 404）：GITHUB_OWNER・GITHUB_REPO、トークンのSelected repositoriesに保存用リポジトリが含まれるかを確認してください。保存先がない場合と、アクセス権がない場合に表示されます。');
      if(status===429 || (status===403 && response.headers.get('x-ratelimit-remaining')==='0'))throw new Error(`GitHub利用制限エラー（HTTP ${status}）：利用制限が解除されてから再デプロイしてください。`);
      if(status===403)throw new Error('GitHubアクセス拒否（HTTP 403）：トークンの権限・組織の承認待ちや利用ポリシー・利用制限を確認してください。');
      if(status>=500)throw new Error(`GitHub通信先エラー（HTTP ${status}）：GitHub側の一時的な問題の可能性があります。少し待って再デプロイしてください。`);
      throw new Error(`GitHubの保存先にアクセスできません（HTTP ${status}）。トークンとリポジトリを確認してください。`);
    }
    const repo=await response.json();
    if (repo.private !== true) throw new Error('質問の保存先には非公開リポジトリが必要です。');
  }
  async load() {
    // 公開設定へ変更された場合にも、次の読み書きで停止する。
    await this.assertPrivate();
    const response=await this.request(`${this.contents}?ref=${encodeURIComponent(this.branch)}`,{headers:{Accept:'application/vnd.github.object+json'}});
    if (response.status===404) {
      const branch=await this.request(`${this.base}/branches/${encodeURIComponent(this.branch)}`);
      if (!branch.ok) throw new Error('保存先のブランチがありません。README付きでリポジトリを作成してください。');
      return {data:emptyData(),sha:undefined};
    }
    if (!response.ok) throw new Error('GitHubからデータを読み込めません。権限と利用制限を確認してください。');
    const file=await response.json();
    if (file.type!=='file' || !file.sha) throw new Error('保存先のファイルを確認してください。');
    let source;
    if (file.encoding==='base64') source=Buffer.from(file.content,'base64').toString('utf8');
    else {
      const raw=await this.request(`${this.contents}?ref=${encodeURIComponent(this.branch)}`,{headers:{Accept:'application/vnd.github.raw+json'}});
      if (!raw.ok) throw new Error('GitHubからデータを読み込めません。');
      source=await raw.text();
    }
    let data;
    try { data=JSON.parse(source); } catch { throw new Error('保存データの形式を確認してください。'); }
    if (data.version!==1 || !Array.isArray(data.questions) || !Array.isArray(data.answers) || !Array.isArray(data.sessions) || !data.editions) throw new Error('保存データの形式を確認してください。');
    return {data,sha:file.sha};
  }
  async read(force=false) {
    if (!force && this.cached && Date.now()-this.cachedAt < this.cacheMs) return structuredClone(this.cached);
    if (!force && this.pending) return structuredClone(await this.pending);
    const promise=this.load().then(value=>{this.cached=value;this.cachedAt=Date.now();return value;});
    if (!force) this.pending=promise;
    try { return structuredClone(await promise); } finally { if (this.pending===promise) this.pending=null; }
  }
  mutate(change) {
    // 同一プロセスは直列化、別プロセスとの競合はGitHubのSHAで検出する。
    const operation=this.queue.then(async()=>{
      for (let attempt=0;attempt<4;attempt++) {
        const {data,sha}=await this.read(true);
        const before=JSON.stringify(data);
        const result=change(data);
        const after=JSON.stringify(data);
        if (before===after) return result;
        const response=await this.request(this.contents,{method:'PUT',body:JSON.stringify({
          message:'QnK: update private data', content:Buffer.from(after).toString('base64'), branch:this.branch, ...(sha?{sha}:{}),
        })});
        if (response.status===409 || response.status===422) {this.cached=null;continue;}
        if (!response.ok) {this.cached=null;throw new Error('GitHubへの保存に失敗しました。権限・利用制限を確認し、少し待って再試行してください。');}
        const saved=await response.json();
        this.cached={data,sha:saved.content?.sha};this.cachedAt=Date.now();
        return result;
      }
      throw new Error('保存処理が混み合っています。少し待って再試行してください。');
    });
    this.queue=operation.catch(()=>{});
    return operation;
  }
}

// ----- api.mjs -----
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
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
    if(required)fail(401,'運営者としてログインしてください。');
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

// QNK_BOOTSTRAP_START
const isEntry=process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(isEntry){
  const required=['ADMIN_EMAIL','ADMIN_PASSWORD','SESSION_SECRET','GITHUB_TOKEN','GITHUB_OWNER','GITHUB_REPO'];
  for(const name of required)if(!process.env[name]){console.error(`環境変数 ${name} を設定してください。`);process.exit(1);}
  if(process.env.ADMIN_PASSWORD.length<12 || process.env.SESSION_SECRET.length<32){console.error('ADMIN_PASSWORDは12文字以上、SESSION_SECRETは32文字以上にしてください。');process.exit(1);}
  const production=process.env.NODE_ENV==='production';
  const appUrl=process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
  if(production && (!appUrl || !/^https:\/\//.test(appUrl))){console.error('公開URLをAPP_URLに設定してください。RenderではRENDER_EXTERNAL_URLも利用できます。');process.exit(1);}
  const store=new GitHubStore({token:process.env.GITHUB_TOKEN,owner:process.env.GITHUB_OWNER,repo:process.env.GITHUB_REPO,branch:process.env.GITHUB_BRANCH || 'main',dataPath:process.env.GITHUB_DATA_PATH || 'qnk/data.json'});
  try{await store.read(true);}catch(error){console.error(error.message);process.exit(1);}
  const server=createServer(createApp({store,config:{adminEmail:process.env.ADMIN_EMAIL,adminPassword:process.env.ADMIN_PASSWORD,sessionSecret:process.env.SESSION_SECRET,production,appUrl},publicDir:new URL('./',import.meta.url)}));
  server.requestTimeout=30_000;server.headersTimeout=20_000;
  server.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log('QnKのWebサーバーを起動しました。'));
  process.on('SIGTERM',()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),10_000).unref();});
}
