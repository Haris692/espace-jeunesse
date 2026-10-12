-- Espace Jeunesse — base partagée.
-- À coller une seule fois dans Supabase : SQL Editor → New query → Run.
--
-- AVANT DE LANCER : remplace CHANGE-MOI (plus bas) par le code
-- d'accès que tu donneras aux encadrants. Ce code n'est écrit nulle part
-- dans le dépôt public : c'est lui qui protège les données des jeunes.
-- Pour le changer plus tard : relancer seulement le bloc « create or replace
-- function public.code_ok » avec le nouveau code.

create table if not exists public.objets (
  id        text primary key,          -- « membres:abc123 », « assises:… »…
  type      text not null,             -- groupes | membres | assises | dars
  data      jsonb,                     -- l'objet entier
  supprime  boolean not null default false,
  maj       timestamptz not null default now()
);

create index if not exists objets_maj on public.objets (maj);

-- l'horodatage vient du serveur, pas du téléphone : c'est lui qui permet de
-- ne relire que ce qui a changé
create or replace function public.objets_touche() returns trigger
language plpgsql as $$
begin
  new.maj := now();
  return new;
end $$;

drop trigger if exists objets_touche on public.objets;
create trigger objets_touche before insert or update on public.objets
  for each row execute function public.objets_touche();

-- Le code d'accès voyage dans un en-tête de chaque requête (x-espace-code).
-- Sans le bon code, la table paraît vide et refuse toute écriture.
create or replace function public.code_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('request.headers', true)::json ->> 'x-espace-code', '') = 'CHANGE-MOI'
$$;
revoke all on function public.code_ok() from public;
grant execute on function public.code_ok() to anon, authenticated;

alter table public.objets enable row level security;

drop policy if exists objets_lire     on public.objets;
drop policy if exists objets_ajouter  on public.objets;
drop policy if exists objets_modifier on public.objets;

create policy objets_lire on public.objets
  for select to anon, authenticated using (public.code_ok());
create policy objets_ajouter on public.objets
  for insert to anon, authenticated with check (public.code_ok() and id <> 'verif');
create policy objets_modifier on public.objets
  for update to anon, authenticated using (public.code_ok() and id <> 'verif')
  with check (public.code_ok() and id <> 'verif');
-- pas de politique DELETE : l'application ne supprime jamais vraiment,
-- elle marque « supprime = true » pour que tous les téléphones l'apprennent.

grant select, insert, update on public.objets to anon, authenticated;

-- ligne témoin : l'application la lit pour vérifier que le code est le bon
insert into public.objets (id, type) values ('verif', 'verif')
  on conflict (id) do nothing;
