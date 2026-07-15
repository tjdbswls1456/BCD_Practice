-- Enforce the recommended attachment limits at the database boundary as well.
create or replace function public.validate_post_attachment_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attachment_count integer;
  attachment_size bigint;
begin
  select count(*), coalesce(sum(a.file_size), 0)
    into attachment_count, attachment_size
  from public.post_attachments a
  where a.post_id = new.post_id;

  if attachment_count >= 5 then
    raise exception '첨부 파일은 게시글당 최대 5개까지 가능합니다.' using errcode = '23514';
  end if;
  if attachment_size + new.file_size > 31457280 then
    raise exception '첨부 파일 전체 크기는 최대 30MB입니다.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_post_attachment_limits on public.post_attachments;
create trigger validate_post_attachment_limits
before insert on public.post_attachments
for each row execute function public.validate_post_attachment_limits();

revoke all on function public.validate_post_attachment_limits() from public, anon, authenticated;
