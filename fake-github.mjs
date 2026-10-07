import {GitHubStore} from './github-store.mjs';
import {emptyData} from './config.mjs';
export function fakeGitHub(initial=null) {
  let data=initial?structuredClone(initial):null, revision=initial?1:0;
  const mock={private:true,conflicts:0,puts:0,branchExists:true,large:false};
  mock.data=()=>structuredClone(data);
  mock.fetch=async(url,options={})=>{
    const address=new URL(url),response=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
    if(address.pathname.endsWith('/contents/qnk/data.json')) {
      if(options.method==='PUT') {
        const input=JSON.parse(options.body);mock.puts++;
        if(mock.conflicts>0){mock.conflicts--;data ||= emptyData();data.editions[2]='https://example.com/second';revision++;return response(409,{});}
        if((revision?String(revision):undefined)!==input.sha)return response(409,{});
        data=JSON.parse(Buffer.from(input.content,'base64').toString('utf8'));revision++;
        return response(200,{content:{sha:String(revision)}});
      }
      if(!data)return response(404,{});
      if(options.headers.Accept==='application/vnd.github.raw+json')return new Response(JSON.stringify(data));
      return response(200,{type:'file',sha:String(revision),encoding:mock.large?'none':'base64',content:mock.large?'':Buffer.from(JSON.stringify(data)).toString('base64')});
    }
    if(address.pathname.includes('/branches/'))return response(mock.branchExists?200:404,{});
    return response(200,{private:mock.private});
  };
  mock.store=()=>new GitHubStore({token:'test-only-token',owner:'test-owner',repo:'test-data',fetchImpl:mock.fetch,cacheMs:0});
  return mock;
}


