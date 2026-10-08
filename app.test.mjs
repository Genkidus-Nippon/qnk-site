import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createApp} from './server.mjs';
import {phase,SCHEDULE,emptyData} from './server.mjs';
import {fakeGitHub} from './fake-github.mjs';

const config={adminEmail:'admin@example.com',adminPassword:'test-only-password-123',sessionSecret:'test-only-session-secret-more-than-32',production:false};
async function fixture(t) {
  const remote=fakeGitHub(emptyData()),store=remote.store();let clock=Date.parse('2026-10-07T10:00:00+09:00');
  const server=createServer(createApp({store,config,now:()=>clock,publicDir:new URL('./',import.meta.url)}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const request=async(path,body,cookie='',origin=base)=>{
    const result=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:result.status,data:(result.headers.get('content-type')||'').startsWith('application/json')?await result.json():await result.text(),cookie:result.headers.get('set-cookie'),headers:result.headers};
  };
  return {remote,store,request,setTime:value=>{clock=value;}};
}
const question=()=>({id:randomUUID(),name:'非公開の名前',affiliation:'ICX',grade:'2年',category:'Summary',question:'活動について教えてください'});
test('Web・別媒体の回答を編集し、初回掲載日を維持して実変更だけ編集日時を記録する',async t=>{
  const {request,setTime}=await fixture(t),q=question();await request('/api/questions',q);const cookie=await login(request);
  const first=Date.parse('2026-10-07T10:00:00+09:00'),second=first+60_000;
  for(const source of ['answer','external']){
    const payload={action:source,questionId:q.id,category:'Summary',question:'公開の質問 '+source,answer:'初回回答'};
    assert.equal((await request('/api/admin',payload,cookie)).status,200);
  }
  const initial=(await request('/api/admin',undefined,cookie)).data.answers;
  assert.equal(initial.length,2);assert.ok(initial.every(a=>a.publishedAt===first&&a.editedAt===null));
  setTime(second);
  for(const a of initial){
    const edit={action:'editAnswer',answerId:a.id,category:a.category,question:a.question,answer:'修正回答'};
    assert.equal((await request('/api/admin',edit)).status,401);
    assert.equal((await request('/api/admin',edit,cookie)).status,200);
    setTime(second+60_000);
    assert.equal((await request('/api/admin',edit,cookie)).status,200);
    setTime(second);
  }
  const result=(await request('/api/answers')).data.answers;
  assert.equal(result.length,2);assert.ok(result.every(a=>a.answer==='修正回答'&&a.publishedAt===first&&a.editedAt===second));
  assert.equal(JSON.stringify(result).includes(q.name),false);
  assert.equal((await request('/api/state')).data.total,1);
  assert.equal((await request('/api/admin',{action:'editAnswer',answerId:randomUUID(),category:'Summary',question:'不存在',answer:'修正'},cookie)).status,404);
});
async function login(request){const result=await request('/api/auth/login',{email:config.adminEmail,password:config.adminPassword});assert.equal(result.status,200);return result.cookie.split(';')[0];}

test('複数の観点を保存し、所属・ジャンルと独立して1件ずつ集計する',async t=>{
  const {request,remote}=await fixture(t),q={...question(),perspectives:['TM','ICX','TM','LCD']};
  assert.equal((await request('/api/questions',q)).status,200);
  assert.equal((await request('/api/questions',{...q,perspectives:['LCD','TM','ICX']})).status,200);
  assert.equal(remote.puts,1);
  const state=(await request('/api/state')).data;
  assert.equal(state.total,1);assert.equal(state.affiliation.ICX,1);
  assert.deepEqual(state.perspectives,{LCD:1,TM:1,BD:0,Mkt:0,F:0,ICX:1,OGX:0,'もろもろ':0});
  assert.equal(JSON.stringify(state).includes(q.name),false);
  const cookie=await login(request);
  assert.deepEqual((await request('/api/admin',undefined,cookie)).data.questions[0].perspectives,['LCD','TM','ICX']);
  assert.equal((await request('/api/questions',{...q,perspectives:['OGX']})).status,409);
  const answer={action:'answer',questionId:q.id,category:'Vision＆Misson',question:'公開する質問',answer:'回答です'};
  assert.equal((await request('/api/admin',answer,cookie)).status,200);
  assert.equal((await request('/api/admin',{...answer,answer:'更新した回答'},cookie)).status,200);
  assert.equal((await request('/api/admin',{...answer,action:'external',questionId:undefined},cookie)).status,200);
  assert.deepEqual((await request('/api/state')).data.perspectives,state.perspectives);
});

test('不正・空の観点は保存せず、追加前の質問を維持する',async t=>{
  const {request,remote,store}=await fixture(t);
  // 観点欄がない旧データは移行せず読み込める。
  const legacy=question();await store.mutate(data=>data.questions.push(legacy));
  assert.equal((await request('/api/state')).data.total,1);
  assert.deepEqual(Object.values((await request('/api/state')).data.perspectives),Array(8).fill(0));
  const initialPuts=remote.puts;
  for(const perspectives of [[],null,'TM',['OTHER'],['TM',123],Array(9).fill('TM')]){
    assert.equal((await request('/api/questions',{...question(),perspectives})).status,400);
  }
  assert.equal(remote.puts,initialPuts);
  assert.equal((await request('/api/questions',{...question(),affiliation:'OGX',perspectives:['BD','Mkt','F','OGX','もろもろ']})).status,200);
  const state=(await request('/api/state')).data;
  assert.equal(state.total,2);assert.equal(state.affiliation.ICX,1);assert.equal(state.affiliation.OGX,1);
  assert.deepEqual(state.perspectives,{LCD:0,TM:0,BD:1,Mkt:1,F:1,ICX:0,OGX:1,'もろもろ':1});
});

test('指定日時の前後で版・終了を判定',()=>{
  for(const [time,before,after] of [[SCHEDULE.second,1,2],[SCHEDULE.third,2,3],[SCHEDULE.end,3,0]]){assert.equal(phase(time-1),before);assert.equal(phase(time),after);}
});
test('質問保存・二重送信防止・集計・運営者だけの受信閲覧',async t=>{
  const {request,remote}=await fixture(t),q=question();
  assert.equal((await request('/api/questions',q)).status,200);
  assert.equal((await request('/api/questions',q)).status,200);
  assert.equal(remote.puts,1);
  const state=(await request('/api/state')).data;
  assert.equal(state.total,1);assert.equal(state.affiliation.ICX,1);assert.equal(state.grade['2年'],1);
  assert.equal(JSON.stringify(state).includes(q.name),false);
  assert.equal((await request('/api/admin')).status,401);
  assert.equal((await request('/api/admin',{action:'edition',edition:2,url:'https://example.com'})).status,401);
  const cookie=await login(request);
  assert.equal((await request('/api/admin',undefined,cookie)).data.questions[0].name,q.name);
  assert.equal((await request('/api/questions',{...q,question:'別の質問'})).status,409);
  assert.equal((await request('/api/questions',{...question(),affiliation:'OTHER'})).status,400);
  assert.equal((await request('/api/questions',{...question(),question:' '.repeat(3)})).status,400);
});
test('回答の公開・更新・別媒体の追加と、公開情報に個人属性を含めない',async t=>{
  const {request}=await fixture(t),q=question();await request('/api/questions',q);const cookie=await login(request);
  const payload={action:'answer',questionId:q.id,category:'Summary',question:'公開用の質問',answer:'回答です'};
  assert.equal((await request('/api/admin',payload,cookie)).status,200);
  assert.equal((await request('/api/admin',{...payload,answer:'更新した回答'},cookie)).status,200);
  assert.equal((await request('/api/admin',{...payload,action:'external',questionId:undefined,question:'別の媒体からの質問'},cookie)).status,200);
  const answers=(await request('/api/answers')).data.answers;
  assert.equal(answers.length,2);assert.equal(answers.find(a=>a.question===payload.question).answer,'更新した回答');
  for(const a of answers)assert.deepEqual(Object.keys(a).sort(),['answer','category','editedAt','id','publishedAt','question']);
  assert.equal((await request('/api/state')).data.total,1);
  assert.equal((await request('/api/admin',{...payload,questionId:randomUUID()},cookie)).status,404);
});
test('CSRF拒否・Cookie改ざん拒否・ログアウト無効化・保存データに生パスワードを含めない',async t=>{
  const {request,remote,store}=await fixture(t);
  assert.equal((await request('/api/questions',question(),'','https://evil.example')).status,403);
  assert.equal((await request('/api/auth/login',{email:config.adminEmail,password:'incorrect'})).status,401);
  const cookie=await login(request);
  assert.equal((await request('/api/auth/me',undefined,cookie)).data.admin,true);
  assert.equal((await request('/api/admin',undefined,cookie+'x')).status,401);
  const saved=JSON.stringify(remote.data());
  assert.equal(saved.includes(config.adminPassword),false);assert.equal(saved.includes(cookie.split('=')[1].split('.')[0]),false);
  await request('/api/auth/logout',{},cookie);
  assert.equal((await request('/api/admin',undefined,cookie)).status,401);
  assert.equal((await store.read()).data.sessions.length,0);
});
test('版変更・資料URLの検証・終了後受付停止・セッション期限',async t=>{
  const {request,setTime}=await fixture(t),cookie=await login(request);
  assert.equal((await request('/api/admin',{action:'edition',edition:2,url:'javascript:alert(1)'},cookie)).status,400);
  assert.equal((await request('/api/admin',{action:'edition',edition:2,url:'https://example.com/second'},cookie)).status,200);
  setTime(SCHEDULE.second);let state=(await request('/api/state')).data;assert.equal(state.edition,2);assert.equal(state.url,'https://example.com/second');
  assert.equal((await request('/api/auth/me',undefined,cookie)).data.admin,false);
  setTime(SCHEDULE.third);state=(await request('/api/state')).data;assert.equal(state.edition,3);assert.equal(state.url,'');
  setTime(SCHEDULE.end);state=(await request('/api/state')).data;assert.equal(state.edition,0);assert.equal(state.url,'');
  assert.equal((await request('/api/questions',question())).status,403);
  assert.deepEqual((await request('/api/answers')).data.answers,[]);
});
test('再起動相当でログインを引き継ぎ、パスワード変更で失効',async t=>{
  const {request,remote}=await fixture(t),cookie=await login(request);
  for(const changed of [false,true]){
    const server=createServer(createApp({store:remote.store(),config:{...config,...(changed?{adminPassword:'replacement-password'}:{})},now:()=>Date.parse('2026-10-07T10:01:00+09:00'),publicDir:new URL('./',import.meta.url)}));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/auth/me`,{headers:{Cookie:cookie}});
    assert.equal((await response.json()).admin,!changed);
    await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
  }
});
test('公開サーバーはSecure・HttpOnly Cookieと設定済みOriginを使う',async t=>{
  const remote=fakeGitHub(emptyData());
  const server=createServer(createApp({store:remote.store(),config:{...config,production:true,appUrl:'https://qnk.example'},publicDir:new URL('./',import.meta.url)}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const result=await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://qnk.example'},body:JSON.stringify({email:config.adminEmail,password:config.adminPassword})});
  assert.equal(result.status,200);assert.match(result.headers.get('set-cookie'),/^__Host-qnk-session=/);assert.match(result.headers.get('set-cookie'),/HttpOnly/);assert.match(result.headers.get('set-cookie'),/Secure/);
});
test('サイト以外のファイルを配信せず、ログインの試行回数を制限',async t=>{
  const {request}=await fixture(t);
  assert.equal((await request('/server.mjs')).status,404);assert.equal((await request('/.env')).status,404);
  assert.equal((await request('/')).status,200);
  for(let i=0;i<8;i++)assert.equal((await request('/api/auth/login',{email:'invalid',password:'invalid'})).status,401);
  assert.equal((await request('/api/auth/login',{email:'invalid',password:'invalid'})).status,429);
});

test('共有プレビューは加工済み画像を配信し、ホームの元画像も維持する',async t=>{
  const {request}=await fixture(t);
  const image=await request('/qnk-share-soft.png');
  assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
  const home=await request('/');
  assert.match(home.data,/property="og:image" content="https:\/\/qnk.onrender.com\/qnk-share-soft.png"/);
  assert.match(home.data,/name="twitter:image" content="https:\/\/qnk.onrender.com\/qnk-share-soft.png"/);
  assert.equal((await request('/kihara.jpg')).status,200);
});

