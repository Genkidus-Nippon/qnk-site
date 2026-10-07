-- SupabaseのAuthentication > Usersで、運営者アカウントを先に作成します。
-- そのUser UIDを下のYOUR_ADMIN_USER_UUIDに貼り付けて、SQL Editorで実行してください。
-- パスワードはこのファイルに書きません。
insert into private.qnk_admins(user_id)
values ('YOUR_ADMIN_USER_UUID'::uuid)
on conflict(user_id) do nothing;
