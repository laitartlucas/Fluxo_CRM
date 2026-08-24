-- Adendo — tags de contato.
--
-- O adendo original pede `name text not null unique` (global). Adaptado
-- para o modelo solo-tenant já em vigor (0020/0021): unique por owner_id,
-- não global — senão a primeira mentora a criar uma tag "VIP" bloquearia
-- todas as outras contas de terem uma tag com o mesmo nome.
begin;

create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.users(id),
  name        text not null,
  color       text,
  created_at  timestamptz not null default now(),
  constraint tags_owner_name_uq unique (owner_id, name)
);

create table public.contact_tags (
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  tag_id      uuid not null references public.tags(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

create index tags_owner_id_idx on public.tags(owner_id);
create index contact_tags_tag_id_idx on public.contact_tags(tag_id);

alter table public.tags enable row level security;
alter table public.contact_tags enable row level security;

create policy tags_all on public.tags
  for all using (public.is_own(owner_id)) with check (public.is_own(owner_id));

create policy contact_tags_all on public.contact_tags
  for all using (
    exists (select 1 from public.contacts c where c.id = contact_tags.contact_id and public.is_own(c.owner_id))
  ) with check (
    exists (select 1 from public.contacts c where c.id = contact_tags.contact_id and public.is_own(c.owner_id))
    and exists (select 1 from public.tags t where t.id = contact_tags.tag_id and public.is_own(t.owner_id))
  );

commit;
