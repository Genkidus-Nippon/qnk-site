import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {writeFile} from 'node:fs/promises';

// 一時的な出力フォルダーを作らず、生成した画面をapp.jsに直接保存する。
const result=await build({
  configFile:false,
  publicDir:false,
  plugins:[react()],
  define:{'process.env.NODE_ENV':'"production"'},
  build:{
    write:false,
    lib:{entry:'main.tsx',formats:['es'],fileName:()=> 'app.js'},
    minify:true,
    sourcemap:false,
  },
});
const bundles=Array.isArray(result)?result:[result];
const output=bundles.flatMap(bundle=>bundle.output);
if(output.length!==1 || output[0].type!=='chunk' || output[0].fileName!=='app.js') throw new Error('画面の生成結果を確認してください。');
await writeFile('app.js',output[0].code,'utf8');
console.log('app.jsを生成しました。');
