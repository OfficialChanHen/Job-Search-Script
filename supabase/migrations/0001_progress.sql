-- Synced progress for the job-hunt app.
--
-- One row per tracked thing: a job's status, a solved problem, a review, a
-- DataAnnotation session, the village… Rows are grouped by namespace (ns).
-- Plain rows merge "newest edit wins" by the client's updated_at, so a phone
-- and a laptop can both edit offline and combine cleanly. Rows that must not
-- be merged blindly (the village, whose gold and food accrue over time) are
-- written with a base_version and only land if nobody else wrote first.

create table if not exists public.kv (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  ns         text        not null,
  key        text        not null,
  value      jsonb,
  deleted    boolean     not null default false,
  updated_at bigint      not null,                         -- client clock, ms
  version    integer     not null default 1,               -- +1 on every accepted write
  server_at  timestamptz not null default clock_timestamp(),  -- pull cursor
  primary key (user_id, ns, key)
);
create index if not exists kv_pull on public.kv (user_id, server_at);

alter table public.kv enable row level security;
create policy "read own rows"   on public.kv for select using (user_id = (select auth.uid()));
create policy "insert own rows" on public.kv for insert with check (user_id = (select auth.uid()));
create policy "update own rows" on public.kv for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Write a batch. Returns one object per input row: the row as stored on the
-- server plus "accepted". A rejected row means the server already had a newer
-- edit (or, for versioned rows, someone else wrote first): the client takes
-- the server's copy and, for versioned rows, re-applies its change on top.
create or replace function public.kv_put(rows jsonb)
returns setof jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r      jsonb;
  cur    public.kv;
  uid    uuid := auth.uid();
  base   integer;
  stamp  bigint;
  done   boolean;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  for r in select * from jsonb_array_elements(rows) loop
    base  := nullif(r->>'base_version', '')::integer;
    stamp := (r->>'updated_at')::bigint;
    select * into cur from public.kv
      where user_id = uid and ns = r->>'ns' and key = r->>'key'
      for update;
    if not found then
      if base is not null and base <> 0 then
        -- versioned row the client thinks exists, but it doesn't: reject
        return next jsonb_build_object('ns', r->>'ns', 'key', r->>'key', 'accepted', false, 'missing', true);
        continue;
      end if;
      insert into public.kv (user_id, ns, key, value, deleted, updated_at)
        values (uid, r->>'ns', r->>'key', r->'value', coalesce((r->>'deleted')::boolean, false), stamp)
        on conflict do nothing
        returning * into cur;
      done := cur.user_id is not null;
      if not done then
        select * into cur from public.kv where user_id = uid and ns = r->>'ns' and key = r->>'key';
      end if;
      return next to_jsonb(cur) - 'user_id' || jsonb_build_object('accepted', done);
    elsif (base is not null and cur.version <> base) or (base is null and cur.updated_at >= stamp) then
      return next to_jsonb(cur) - 'user_id' || jsonb_build_object('accepted', false);
    else
      update public.kv
        set value = r->'value', deleted = coalesce((r->>'deleted')::boolean, false),
            updated_at = stamp, version = cur.version + 1, server_at = clock_timestamp()
        where user_id = uid and ns = cur.ns and key = cur.key
        returning * into cur;
      return next to_jsonb(cur) - 'user_id' || jsonb_build_object('accepted', true);
    end if;
  end loop;
end;
$$;

grant execute on function public.kv_put(jsonb) to authenticated;

-- Live updates to other open devices.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.kv;
  end if;
exception when duplicate_object then null;
end $$;
