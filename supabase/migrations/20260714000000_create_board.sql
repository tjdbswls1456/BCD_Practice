-- Board tables, security policies, indexes, and password-protected mutations.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.posts (
  id bigint generated always as identity primary key,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  title varchar(200) not null check (char_length(trim(title)) between 1 and 200),
  content text not null check (char_length(trim(content)) > 0),
  password_hash text not null,
  is_secret boolean not null default false,
  view_count integer not null default 0 check (view_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.post_attachments (
  id uuid primary key default gen_random_uuid(),
  post_id bigint not null references public.posts(id) on delete cascade,
  uploader_id uuid not null references auth.users(id) on delete cascade,
  original_name text not null,
  storage_path text not null unique,
  mime_type text,
  file_size bigint not null check (file_size >= 0 and file_size <= 10485760),
  created_at timestamptz not null default now()
);

create table if not exists public.post_likes (
  post_id bigint not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists posts_created_at_idx
  on public.posts (created_at desc);
create index if not exists posts_author_id_idx
  on public.posts (author_id);
create index if not exists posts_title_search_idx
  on public.posts using gin (title extensions.gin_trgm_ops);
create index if not exists posts_author_name_search_idx
  on public.posts using gin (author_name extensions.gin_trgm_ops);
create index if not exists post_attachments_post_id_idx
  on public.post_attachments (post_id);
create index if not exists post_likes_post_id_idx
  on public.post_likes (post_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_posts_updated_at on public.posts;
create trigger set_posts_updated_at
before update on public.posts
for each row execute function public.set_updated_at();

alter table public.posts enable row level security;
alter table public.post_attachments enable row level security;
alter table public.post_likes enable row level security;

drop policy if exists "Authenticated users can read visible posts" on public.posts;
create policy "Authenticated users can read visible posts"
on public.posts for select
to authenticated
using (not is_secret or author_id = (select auth.uid()));

drop policy if exists "Authenticated users can read visible attachments" on public.post_attachments;
create policy "Authenticated users can read visible attachments"
on public.post_attachments for select
to authenticated
using (
  exists (
    select 1
    from public.posts p
    where p.id = post_id
      and (not p.is_secret or p.author_id = (select auth.uid()))
  )
);

drop policy if exists "Authors can add attachment metadata" on public.post_attachments;
create policy "Authors can add attachment metadata"
on public.post_attachments for insert
to authenticated
with check (
  uploader_id = (select auth.uid())
  and split_part(storage_path, '/', 1) = (select auth.uid())::text
  and exists (
    select 1 from public.posts p
    where p.id = post_id and p.author_id = (select auth.uid())
  )
);

drop policy if exists "Authors can remove attachment metadata" on public.post_attachments;
create policy "Authors can remove attachment metadata"
on public.post_attachments for delete
to authenticated
using (
  uploader_id = (select auth.uid())
  and exists (
    select 1 from public.posts p
    where p.id = post_id and p.author_id = (select auth.uid())
  )
);

drop policy if exists "Authenticated users can read likes on visible posts" on public.post_likes;
create policy "Authenticated users can read likes on visible posts"
on public.post_likes for select
to authenticated
using (
  exists (
    select 1 from public.posts p
    where p.id = post_id
      and (not p.is_secret or p.author_id = (select auth.uid()))
  )
);

drop policy if exists "Users can like visible posts" on public.post_likes;
create policy "Users can like visible posts"
on public.post_likes for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.posts p
    where p.id = post_id
      and (not p.is_secret or p.author_id = (select auth.uid()))
  )
);

drop policy if exists "Users can remove their own likes" on public.post_likes;
create policy "Users can remove their own likes"
on public.post_likes for delete
to authenticated
using (user_id = (select auth.uid()));

-- Clients call this function instead of inserting password hashes directly.
create or replace function public.create_post(
  post_title text,
  post_password text,
  post_content text,
  post_is_secret boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_author_name text;
  new_post_id bigint;
begin
  if current_user_id is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(post_title, ''))) not between 1 and 200 then
    raise exception '제목은 1자 이상 200자 이하로 입력해 주세요.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(post_content, ''))) = 0 then
    raise exception '내용을 입력해 주세요.' using errcode = '22023';
  end if;
  if char_length(coalesce(post_password, '')) not between 4 and 100 then
    raise exception '게시글 비밀번호는 4자 이상 100자 이하로 입력해 주세요.' using errcode = '22023';
  end if;

  select nullif(trim(p.full_name), '')
    into current_author_name
  from public.profiles p
  where p.id = current_user_id;

  insert into public.posts (
    author_id, author_name, title, content, password_hash, is_secret
  ) values (
    current_user_id,
    coalesce(current_author_name, '사용자'),
    trim(post_title),
    post_content,
    extensions.crypt(post_password, extensions.gen_salt('bf')),
    coalesce(post_is_secret, false)
  )
  returning id into new_post_id;

  return new_post_id;
end;
$$;

create or replace function public.update_post(
  target_post_id bigint,
  post_password text,
  post_title text,
  post_content text,
  post_is_secret boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(post_title, ''))) not between 1 and 200 then
    raise exception '제목은 1자 이상 200자 이하로 입력해 주세요.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(post_content, ''))) = 0 then
    raise exception '내용을 입력해 주세요.' using errcode = '22023';
  end if;

  update public.posts
  set title = trim(post_title),
      content = post_content,
      is_secret = coalesce(post_is_secret, false)
  where id = target_post_id
    and author_id = auth.uid()
    and password_hash = extensions.crypt(post_password, password_hash);

  if not found then
    raise exception '게시글이 없거나 비밀번호가 올바르지 않습니다.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.delete_post(
  target_post_id bigint,
  post_password text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;

  delete from public.posts
  where id = target_post_id
    and author_id = auth.uid()
    and password_hash = extensions.crypt(post_password, password_hash);

  if not found then
    raise exception '게시글이 없거나 비밀번호가 올바르지 않습니다.' using errcode = '42501';
  end if;
end;
$$;

revoke all on table public.posts from anon, authenticated;
grant select (id, author_id, author_name, title, content, is_secret, view_count, created_at, updated_at)
  on public.posts to authenticated;

revoke all on table public.post_attachments from anon, authenticated;
grant select, insert, delete on table public.post_attachments to authenticated;

revoke all on table public.post_likes from anon, authenticated;
grant select, insert, delete on table public.post_likes to authenticated;

revoke all on function public.create_post(text, text, text, boolean) from public, anon;
grant execute on function public.create_post(text, text, text, boolean) to authenticated;
revoke all on function public.update_post(bigint, text, text, text, boolean) from public, anon;
grant execute on function public.update_post(bigint, text, text, text, boolean) to authenticated;
revoke all on function public.delete_post(bigint, text) from public, anon;
grant execute on function public.delete_post(bigint, text) to authenticated;

-- Private bucket. Object paths must start with the uploader's user UUID.
insert into storage.buckets (id, name, public, file_size_limit)
values ('post-files', 'post-files', false, 10485760)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "Users can upload their own post files" on storage.objects;
create policy "Users can upload their own post files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'post-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can read visible post files" on storage.objects;
create policy "Users can read visible post files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'post-files'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.post_attachments a
      join public.posts p on p.id = a.post_id
      where a.storage_path = name
        and (not p.is_secret or p.author_id = (select auth.uid()))
    )
  )
);

drop policy if exists "Users can delete their own post files" on storage.objects;
create policy "Users can delete their own post files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'post-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
