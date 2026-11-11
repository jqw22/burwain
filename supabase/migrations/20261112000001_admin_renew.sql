-- Club admins renew (or add) a membership for a member, for this year or next year once it's open.
-- The membership covers the member and/or people in their family; the family's main contact pays.
create function admin_renew_membership(p_person uuid, p_type_id uuid, p_person_ids uuid[], p_club_year_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  hh    uuid;
  payer uuid;
begin
  if not has_role('admin') then raise exception 'Only an admin can renew memberships for members'; end if;
  if not exists (select 1 from club_years
                  where id = p_club_year_id and club_today() between starts_on - renewal_notice_days() and ends_on) then
    raise exception 'That club year is not open for membership yet';
  end if;
  select household_id into hh from people where id = p_person and archived_at is null;
  if not found then raise exception 'That member could not be found'; end if;
  payer := coalesce((select lead_person_id from households where id = hh), p_person);
  if exists (select 1 from unnest(p_person_ids) pid
              where pid <> p_person and pid not in (select id from people where household_id = hh and hh is not null and archived_at is null)) then
    raise exception 'You can only add people from your own household';
  end if;
  if (select cover from membership_types where id = p_type_id) = 'family' and cardinality(p_person_ids) > 4 then
    raise exception 'A Family membership covers up to 4 people';
  end if;
  return create_membership(payer, p_type_id, p_person_ids, p_club_year_id, true);
end $$;
revoke execute on function admin_renew_membership(uuid, uuid, uuid[], uuid) from public, anon;
grant execute on function admin_renew_membership(uuid, uuid, uuid[], uuid) to authenticated;

-- Contacts: people on the list for club emails who aren't members (no membership, no family needed).
alter table people add column is_contact boolean not null default false;
comment on column people.is_contact is 'Added as a contact only (for email lists), not as a member.';

create function admin_add_contact(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(nullif(trim(p->>'email'), ''));
  new_id  uuid;
begin
  if not has_role('admin') then raise exception 'Only an admin can add contacts'; end if;
  if coalesce(trim(p->>'first_name'), '') = '' or coalesce(trim(p->>'last_name'), '') = '' then
    raise exception 'First and last name are needed';
  end if;
  if v_email is null then raise exception 'An email address is needed for a contact'; end if;
  if exists (select 1 from people where lower(email) = v_email and archived_at is null) then
    raise exception 'Someone already uses that email (%)', v_email;
  end if;
  insert into people (first_name, last_name, email, mobile, is_contact, news_consent, news_consent_at, directory_opt_out)
  values (trim(p->>'first_name'), trim(p->>'last_name'), v_email, nullif(trim(p->>'mobile'), ''), true,
          coalesce((p->>'news_consent')::boolean, false),
          case when coalesce((p->>'news_consent')::boolean, false) then now() end, true)
  returning id into new_id;
  return new_id;
end $$;
revoke execute on function admin_add_contact(jsonb) from public, anon;
grant execute on function admin_add_contact(jsonb) to authenticated;
