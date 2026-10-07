import {useState,type FormEvent} from 'react';
import {Lock,ArrowRight} from 'lucide-react';
import {login} from './services';
export function LoginPanel({onLoggedIn}:{onLoggedIn:()=>void}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;const data=new FormData(form);setBusy(true);setError('');try{await login(String(data.get('email')),String(data.get('password')));form.reset();onLoggedIn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="form-surface restricted"><Lock size={32}/><h2>運営者専用ページ</h2><p>運営者のメールアドレスと、QnK用のパスワードでログインしてください。</p><form className="login-form" onSubmit={submit}><label className="field">メールアドレス<input type="email" name="email" autoComplete="username" required/></label><label className="field">パスワード<input type="password" name="password" autoComplete="current-password" required minLength={12}/></label>{error&&<p className="error" role="alert">{error}</p>}<button className="primary-button full" disabled={busy}>{busy?'ログインしています…':'運営者としてログイン'}<ArrowRight size={17}/></button></form><p className="small">権限のないアカウントでは質問内容を閲覧できません。</p></div>;
}
