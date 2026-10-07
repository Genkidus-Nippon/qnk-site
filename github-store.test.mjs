import test from 'node:test';
import assert from 'node:assert/strict';
import {GitHubStore} from './github-store.mjs';
import {emptyData} from './config.mjs';

import {fakeGitHub} from './fake-github.mjs';

test('公開リポジトリへの保存を拒否する',async()=>{
  const remote=fakeGitHub();remote.private=false;
  await assert.rejects(remote.store().read(),/非公開/);assert.equal(remote.puts,0);
});
test('初回保存・並列保存・再起動後の読み込み',async()=>{
  const remote=fakeGitHub(),store=remote.store();
  await Promise.all(Array.from({length:5},(_,id)=>store.mutate(data=>data.questions.push({id}))));
  assert.equal((await remote.store().read()).data.questions.length,5);
  assert.equal(remote.puts,5);
  await store.mutate(()=>{});assert.equal(remote.puts,5);
});
test('他プロセスの更新と競合しても、再読込で更新を保持',async()=>{
  const remote=fakeGitHub(emptyData());remote.conflicts=1;
  await remote.store().mutate(data=>data.questions.push({id:'new'}));
  assert.equal(remote.data().editions[2],'https://example.com/second');
  assert.equal(remote.data().questions.length,1);assert.equal(remote.puts,2);
});
test('未作成ブランチは初期データとして上書きしない',async()=>{
  const remote=fakeGitHub();remote.branchExists=false;
  await assert.rejects(remote.store().read(),/ブランチ/);
});
test('1MB以上を想定したraw読み込み',async()=>{
  const remote=fakeGitHub(emptyData());remote.large=true;
  assert.deepEqual((await remote.store().read()).data,emptyData());
});

