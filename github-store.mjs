import {emptyData} from './config.mjs';

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
