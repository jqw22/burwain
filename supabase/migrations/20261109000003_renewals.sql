-- Renewals and joining, done safely by members themselves.
-- 1. The price date is always today (members could previously pass any date and pay a smaller pro rata).
-- 2. Members can buy for the current club year, or for next year once renewals open (60 days before 1 March).
--    Buying for a year that hasn't started yet is always full price.
-- 3. Junior sibling pricing is picked automatically: 1st junior J1, 2nd J2, 3rd and later J3.
-- 4. No one can hold the same type twice in a year, or two sailing memberships in a year.
-- 5. Members can cancel a membership they haven't paid for yet.

-- "Today" for club rules. A function so the database tests can fix the date.
create function club_today() returns date
language sql stable set search_path = public as $$ select current_date $$;

create function renewal_notice_days() returns integer
language sql immutable set search_path = public as $$ select 60 $$;

-- Club years a member can buy for right now: this year, plus next year once its renewal window opens.
create function open_club_years()
returns table (id uuid, label text, starts_on date, ends_on date, is_renewal boolean)
language sql stable security definer set search_path = public as $$
  select cy.id, cy.label, cy.starts_on, cy.ends_on, cy.starts_on > club_today()
    from club_years cy
   where club_today() between cy.starts_on - renewal_notice_days() and cy.ends_on
     and current_person_id() is not null
   order by cy.starts_on
$$;

-- Price for a type in a club year if bought today. Full price before the year starts or in its first month.
create function membership_quote(p_type_id uuid, p_club_year_id uuid)
returns table (price_pence integer, months integer)
language sql stable security definer set search_path = public as $$
  select round(t.annual_price_pence * m.months / 12.0)::int, m.months
    from membership_types t, club_years cy,
         lateral (select case when club_today() <= cy.starts_on + 30 then 12
                              else prorata_months(club_today()) end as months) m
   where t.id = p_type_id and cy.id = p_club_year_id
$$;

drop function start_membership(uuid, uuid[], date);

create function start_membership(p_type_id uuid, p_person_ids uuid[], p_club_year_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me      uuid := current_person_id();
  hh      uuid;
  mt      membership_types;
  yr      club_years;
  juniors int;
  q       record;
  new_id  uuid;
begin
  if me is null then raise exception 'Not logged in'; end if;
  select * into mt from membership_types where id = p_type_id and is_open;
  if not found then raise exception 'Membership type not available'; end if;
  select cy.* into yr from club_years cy join open_club_years() o on o.id = cy.id where cy.id = p_club_year_id;
  if not found then raise exception 'That club year is not open for membership yet'; end if;
  if coalesce(cardinality(p_person_ids), 0) = 0 then raise exception 'Choose who the membership is for'; end if;

  select household_id into hh from people where id = me;
  if exists (select 1 from unnest(p_person_ids) pid
             where pid <> me and pid not in (select id from people where household_id = hh and hh is not null)) then
    raise exception 'You can only add people from your own household';
  end if;
  if mt.cover in ('individual', 'junior') and cardinality(p_person_ids) <> 1 then
    raise exception '% covers exactly one person', mt.name;
  end if;
  if mt.cover = 'dual' and cardinality(p_person_ids) <> 2 then
    raise exception '% covers exactly two adults', mt.name;
  end if;
  if mt.max_age is not null and exists (
       select 1 from people where id = any(p_person_ids)
       and (date_of_birth is null or date_part('year', age(yr.starts_on, date_of_birth)) > mt.max_age)) then
    raise exception 'Someone is over the age limit for % (date of birth needed)', mt.name;
  end if;
  if mt.requires_adult_member and not exists (
       select 1 from memberships m
       join membership_types t on t.id = m.membership_type_id
       where m.club_year_id = yr.id and m.household_id = hh
         and t.cover <> 'junior' and m.status in ('active', 'awaiting_payment')) then
    raise exception 'A junior needs an adult in the household to hold a membership this year';
  end if;

  -- Junior sibling pricing: count this year's junior memberships in the household.
  if mt.sibling_order is not null then
    select count(*) into juniors
      from memberships m join membership_types t on t.id = m.membership_type_id
     where m.club_year_id = yr.id and m.household_id = hh and t.sibling_order is not null
       and m.status <> 'cancelled';
    select * into mt from membership_types
     where sibling_order = least(juniors + 1, 3) and cover = 'junior' and is_open
     order by sort_order limit 1;
    if not found then raise exception 'Junior membership not available'; end if;
  end if;

  if exists (
       select 1 from memberships m
       join membership_people mp on mp.membership_id = m.id
       join membership_types t on t.id = m.membership_type_id
       where m.club_year_id = yr.id and m.status <> 'cancelled' and mp.person_id = any(p_person_ids)
         and (t.id = mt.id or (t.category = 'sailing' and mt.category = 'sailing'))) then
    raise exception 'Someone already has this kind of membership for %', yr.label;
  end if;

  select * into q from membership_quote(mt.id, yr.id);

  insert into memberships (club_year_id, membership_type_id, payer_person_id, household_id,
                           status, price_pence, prorata_months)
  values (yr.id, mt.id, me, hh,
          case when mt.requires_approval then 'pending_approval' else 'awaiting_payment' end::membership_status,
          q.price_pence, q.months)
  returning id into new_id;

  insert into membership_people (membership_id, person_id)
  select new_id, unnest(p_person_ids);
  return new_id;
end $$;

-- Members can cancel an unpaid membership they took out (a mistaken choice, say).
create function cancel_my_membership(p_membership uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update memberships set status = 'cancelled'
   where id = p_membership
     and payer_person_id = current_person_id()
     and status in ('awaiting_payment', 'pending_approval')
     and not exists (select 1 from payment_lines where membership_id = p_membership);
  if not found then raise exception 'Only an unpaid membership you took out can be cancelled'; end if;
end $$;

revoke execute on function club_today(), renewal_notice_days(), open_club_years(),
  membership_quote(uuid, uuid), start_membership(uuid, uuid[], uuid), cancel_my_membership(uuid)
  from public, anon;
grant execute on function club_today(), renewal_notice_days(), open_club_years(),
  membership_quote(uuid, uuid), start_membership(uuid, uuid[], uuid), cancel_my_membership(uuid)
  to authenticated;
