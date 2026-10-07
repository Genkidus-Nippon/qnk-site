-- QnK専用の新規SupabaseプロジェクトのSQL Editorで実行します。
-- privateはAPIのExposed schemasに追加しないでください。
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;
create table if not exists private.qnk_admins (
 user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists private.qnk_questions (
 id uuid primary key,
 name text not null check (length(btrim(name)) between 1 and 80),
 affiliation text check (affiliation in ('ICX','OGX')),
 grade text check (grade in ('1年','2年','3年','4年','大学院','その他')),
 category text not null check (category in ('Summary','Vision＆Misson','Goal＆Isse','Direction Analysis','Current Anlysis','Strategy','Personality','Appendix','もろもろ')),
 question text not null check (length(btrim(question)) between 1 and 5000),
 source text not null check (source in ('web','external')),
 created_at timestamptz not null default now(),
 check (source<>'web' or (affiliation is not null and grade is not null))
);
create table if not exists private.qnk_answers (
 id uuid primary key default gen_random_uuid(),
 question_id uuid unique not null references private.qnk_questions(id),
 question text not null check (length(btrim(question)) between 1 and 5000),
 answer text not null check (length(btrim(answer)) between 1 and 10000),
 category text not null check (category in ('Summary','Vision＆Misson','Goal＆Isse','Direction Analysis','Current Anlysis','Strategy','Personality','Appendix','もろもろ')),
 published_at timestamptz not null default now()
);
create table if not exists private.qnk_editions (
 id integer primary key check (id between 1 and 3),
 url text not null check (url ~ '^https://[^[:space:]]+$')
);
alter table private.qnk_admins enable row level security;
alter table private.qnk_questions enable row level security;
alter table private.qnk_answers enable row level security;
alter table private.qnk_editions enable row level security;
revoke all on private.qnk_admins,private.qnk_questions,private.qnk_answers,private.qnk_editions from public,anon,authenticated;
-- 一般利用者・運営者とも、テーブルを直接読む権限は付けません。
-- APIは公開する項目を選び、運営操作ではログイン済みユーザーIDを検証します。
insert into private.qnk_editions (id,url) values (1,'https://drive.google.com/file/d/1o19JfD3iWelpRjefFSz7JlY-iQ7SeVdX/view?usp=drive_link') on conflict(id) do nothing;

create or replace function private.qnk_phase(p_now timestamptz) returns integer language sql immutable set search_path='' as $$
 select case when p_now >= timestamptz '2026-11-09 00:00:00+09' then 0
 when p_now >= timestamptz '2026-11-03 12:00:00+09' then 3
 when p_now >= timestamptz '2026-10-20 12:00:00+09' then 2 else 1 end;
$$;
create or replace function private.qnk_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.qnk_admins where user_id=(select auth.uid()));
$$;
create or replace function private.qnk_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare p_now timestamptz:=clock_timestamp(); p_edition integer; aff jsonb; grades jsonb; count_total bigint; document text;
begin
 p_edition:=private.qnk_phase(p_now);
 select jsonb_build_object('ICX',count(*) filter(where affiliation='ICX'),'OGX',count(*) filter(where affiliation='OGX')),count(*)
 into aff,count_total from private.qnk_questions where source='web';
 select jsonb_object_agg(g.grade,(select count(*) from private.qnk_questions q where q.source='web' and q.grade=g.grade)) into grades
 from (values ('1年'),('2年'),('3年'),('4年'),('大学院'),('その他')) g(grade);
 select url into document from private.qnk_editions where id=p_edition;
 return jsonb_build_object('now',floor(extract(epoch from p_now)*1000),'edition',p_edition,'affiliation',aff,'grade',grades,'total',count_total,'url',document);
end;
$$;
create or replace function private.qnk_answers() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('answers',coalesce(jsonb_agg(jsonb_build_object('id',id,'question',question,'answer',answer,'category',category,'publishedAt',floor(extract(epoch from published_at)*1000)) order by published_at desc),'[]'::jsonb)) from private.qnk_answers;
$$;
create or replace function private.qnk_submit_question(p_id uuid,p_name text,p_affiliation text,p_grade text,p_category text,p_question text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if private.qnk_phase(clock_timestamp())=0 then raise exception '質問の受付は終了しました。'; end if;
 if p_id is null or p_name is null or length(btrim(p_name)) not between 1 and 80 or p_question is null or length(btrim(p_question)) not between 1 and 5000
 or p_affiliation is null or p_affiliation not in ('ICX','OGX') or p_grade is null or p_grade not in ('1年','2年','3年','4年','大学院','その他')
 or p_category is null or p_category not in ('Summary','Vision＆Misson','Goal＆Isse','Direction Analysis','Current Anlysis','Strategy','Personality','Appendix','もろもろ') then raise exception '入力内容を確認してください。'; end if;
 insert into private.qnk_questions(id,name,affiliation,grade,category,question,source) values(p_id,btrim(p_name),p_affiliation,p_grade,p_category,btrim(p_question),'web') on conflict(id) do nothing;
 return jsonb_build_object('ok',true);
end;
$$;
create or replace function private.qnk_admin_inbox() returns jsonb language plpgsql security definer set search_path='' as $$
declare inbox jsonb;documents jsonb;
begin
 if not private.qnk_is_admin() then raise exception '運営者権限が必要です。'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'name',q.name,'affiliation',q.affiliation,'grade',q.grade,'category',q.category,'question',q.question,'source',q.source,'created_at',floor(extract(epoch from q.created_at)*1000),'answer',a.answer,'publicQuestion',a.question) order by q.created_at desc),'[]'::jsonb)
 into inbox from private.qnk_questions q left join private.qnk_answers a on a.question_id=q.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'url',url) order by id),'[]'::jsonb) into documents from private.qnk_editions;
 return jsonb_build_object('questions',inbox,'editions',documents);
end;
$$;
create or replace function private.qnk_admin_save(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare qid uuid;action text:=p_data->>'action';category_value text:=p_data->>'category';question_value text:=btrim(p_data->>'question');answer_value text:=btrim(p_data->>'answer');edition_id integer;document_url text;
begin
 if not private.qnk_is_admin() then raise exception '運営者権限が必要です。'; end if;
 if action='edition' then
  edition_id:=(p_data->>'edition')::integer;document_url:=p_data->>'url';
  if edition_id is null or edition_id not between 1 and 3 or document_url is null or document_url !~ '^https://[^[:space:]]+$' then raise exception '資料のURLを確認してください。';end if;
  insert into private.qnk_editions(id,url) values(edition_id,document_url) on conflict(id) do update set url=excluded.url;
  return jsonb_build_object('ok',true);
 end if;
 if question_value is null or length(question_value) not between 1 and 5000 or answer_value is null or length(answer_value) not between 1 and 10000
 or category_value is null or category_value not in ('Summary','Vision＆Misson','Goal＆Isse','Direction Analysis','Current Anlysis','Strategy','Personality','Appendix','もろもろ') then raise exception '質問と回答の入力内容を確認してください。';end if;
 if action='external' then
  qid:=gen_random_uuid();insert into private.qnk_questions(id,name,category,question,source) values(qid,'別媒体',category_value,question_value,'external');
 elsif action='answer' then
  qid:=(p_data->>'questionId')::uuid;
  if qid is null or not exists(select 1 from private.qnk_questions where id=qid) then raise exception '質問が見つかりません。';end if;
 else raise exception '入力内容を確認してください。';end if;
 insert into private.qnk_answers(question_id,question,answer,category) values(qid,question_value,answer_value,category_value)
 on conflict(question_id) do update set question=excluded.question,answer=excluded.answer,category=excluded.category,published_at=now();
 return jsonb_build_object('ok',true);
end;
$$;

-- 公開スキーマには権限を昇格しない窓口だけを置きます。
create or replace function public.qnk_state() returns jsonb language sql security invoker set search_path='' as $$select private.qnk_state();$$;
create or replace function public.qnk_answers() returns jsonb language sql security invoker set search_path='' as $$select private.qnk_answers();$$;
create or replace function public.qnk_is_admin() returns boolean language sql security invoker set search_path='' as $$select private.qnk_is_admin();$$;
create or replace function public.qnk_submit_question(p_id uuid,p_name text,p_affiliation text,p_grade text,p_category text,p_question text) returns jsonb language sql security invoker set search_path='' as $$select private.qnk_submit_question(p_id,p_name,p_affiliation,p_grade,p_category,p_question);$$;
create or replace function public.qnk_admin_inbox() returns jsonb language sql security invoker set search_path='' as $$select private.qnk_admin_inbox();$$;
create or replace function public.qnk_admin_save(p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.qnk_admin_save(p_data);$$;

revoke all on function private.qnk_phase(timestamptz),private.qnk_is_admin(),private.qnk_state(),private.qnk_answers(),private.qnk_submit_question(uuid,text,text,text,text,text),private.qnk_admin_inbox(),private.qnk_admin_save(jsonb) from public,anon,authenticated;
revoke all on function public.qnk_state(),public.qnk_answers(),public.qnk_is_admin(),public.qnk_submit_question(uuid,text,text,text,text,text),public.qnk_admin_inbox(),public.qnk_admin_save(jsonb) from public,anon,authenticated;
grant execute on function private.qnk_state(),private.qnk_answers(),private.qnk_submit_question(uuid,text,text,text,text,text),private.qnk_is_admin() to anon,authenticated;
grant execute on function public.qnk_state(),public.qnk_answers(),public.qnk_submit_question(uuid,text,text,text,text,text),public.qnk_is_admin() to anon,authenticated;
grant execute on function private.qnk_admin_inbox(),private.qnk_admin_save(jsonb),public.qnk_admin_inbox(),public.qnk_admin_save(jsonb) to authenticated;
commit;
