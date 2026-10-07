export async function api(path:string,body?:unknown):Promise<any>{
  let response:Response;
  try {response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
  catch {throw new Error('通信できません。接続を確認して再試行してください。');}
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'処理に失敗しました。少し待って再試行してください。');
  return data;
}
function notify(){window.dispatchEvent(new Event('qnk-auth-change'));}
export async function isAdmin():Promise<boolean>{try{return (await api('/api/auth/me')).admin===true;}catch{return false;}}
export async function login(email:string,password:string){await api('/api/auth/login',{email,password});notify();}
export async function logout(){await api('/api/auth/logout',{});notify();}
export function onAuthChange(callback:()=>void){window.addEventListener('qnk-auth-change',callback);window.addEventListener('focus',callback);return()=>{window.removeEventListener('qnk-auth-change',callback);window.removeEventListener('focus',callback);};}
