-- 1. Member directory for signed-in members: name, phone, email and membership type.
--    It no longer depends on payment, so it doesn't reveal who has paid. Adults only, opt-out respected.
-- 2. A Family membership covers everyone in the family, including people added after it was taken out.

drop function member_directory();

create function member_directory()
returns table (id uuid, first_name text, last_name text, mobile text, email text, membership text)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, p.mobile, p.email,
         string_agg(distinct t.name, ', ')
    from people p
    join membership_people mp on mp.person_id = p.id
    join memberships m on m.id = mp.membership_id
    join membership_types t on t.id = m.membership_type_id
   where m.club_year_id = current_club_year_id()
     and m.status in ('active', 'awaiting_payment')
     and not p.directory_opt_out
     and p.archived_at is null
     and p.date_of_birth <= current_date - interval '18 years'   -- adults only (safeguarding)
     and current_person_id() is not null
   group by p.id
   order by p.last_name, p.first_name
$$;

revoke execute on function member_directory() from public, anon;
grant execute on function member_directory() to authenticated;

-- Add a person to their family's Family memberships for this year and any future year,
-- unless they already have a membership of their own for that year.
create function cover_with_family_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.household_id is null or new.archived_at is not null then return new; end if;
  -- Memberships someone took out before they had a family group now belong to that family.
  update memberships set household_id = new.household_id
   where payer_person_id = new.id and household_id is null;
  insert into membership_people (membership_id, person_id)
  select m.id, new.id
    from memberships m
    join membership_types t on t.id = m.membership_type_id
    join club_years cy on cy.id = m.club_year_id
   where m.household_id = new.household_id
     and t.cover = 'family'
     and m.status <> 'cancelled'
     and cy.ends_on >= current_date
     and not exists (select 1 from membership_people x join memberships y on y.id = x.membership_id
                      where x.person_id = new.id and y.club_year_id = m.club_year_id and y.status <> 'cancelled')
  on conflict do nothing;
  return new;
end $$;
revoke execute on function cover_with_family_membership() from public, anon, authenticated;

create trigger cover_with_family_membership after insert or update of household_id on people
  for each row execute function cover_with_family_membership();

-- Memberships taken out before the payer had a family group belong to that family now.
update memberships m set household_id = p.household_id
  from people p
 where m.household_id is null and p.id = m.payer_person_id and p.household_id is not null;

-- Catch up anyone already added to a family after its Family membership was taken out.
insert into membership_people (membership_id, person_id)
select m.id, p.id
  from memberships m
  join membership_types t on t.id = m.membership_type_id
  join club_years cy on cy.id = m.club_year_id
  join people p on p.household_id = m.household_id and p.archived_at is null
 where t.cover = 'family' and m.status <> 'cancelled' and cy.ends_on >= current_date
   -- Leave alone anyone who already has their own membership that year.
   and not exists (select 1 from membership_people x join memberships y on y.id = x.membership_id
                    where x.person_id = p.id and y.club_year_id = m.club_year_id and y.status <> 'cancelled')
on conflict do nothing;
