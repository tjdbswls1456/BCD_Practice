-- Increment view counts only through an authenticated, visibility-aware function.
create or replace function public.increment_post_view(target_post_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_view_count integer;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;

  update public.posts
  set view_count = view_count + 1
  where id = target_post_id
    and (not is_secret or author_id = auth.uid())
  returning view_count into new_view_count;

  if new_view_count is null then
    raise exception '게시글을 찾을 수 없거나 조회 권한이 없습니다.' using errcode = '42501';
  end if;

  return new_view_count;
end;
$$;

revoke all on function public.increment_post_view(bigint) from public, anon;
grant execute on function public.increment_post_view(bigint) to authenticated;
