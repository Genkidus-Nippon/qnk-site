import {createServer} from 'node:http';
import {GitHubStore} from './github-store.mjs';
import {createApp} from './api.mjs';

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
