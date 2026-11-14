-- James (2026-11-14):
-- 1. Members whose membership has lapsed can still renew from their own account. my_renewals() now also lists
--    each person's latest membership once it has ended (as well as memberships in the 60-day window before they end).
-- 2. Pro rata prices are for brand-new members only. Anyone who has had a membership before pays the full price,
--    even if it lapsed.

-- People I can renew: on a membership I look after (as payer or family main contact) that ends within the
-- next 60 days, or that has ended and is their latest membership. "renewed" says they already have a
-- membership starting later.
create or replace function my_renewals()
returns table (person_id uuid, membership_id uuid, type_id uuid, code text, starts_on date, ends_on date, renewed boolean)
language sql stable security definer set search_path = public as $$
  select distinct on (mp.person_id, m.id) mp.person_id, m.id, t.id, t.code, t.starts_on, t.ends_on,
         exists (select 1 from membership_people x
                   join memberships y on y.id = x.membership_id
                   join membership_types u on u.id = y.membership_type_id
                  where x.person_id = mp.person_id and y.status <> 'cancelled' and u.starts_on > t.starts_on)
    from memberships m
    join membership_types t on t.id = m.membership_type_id
    join membership_people mp on mp.membership_id = m.id
    join people p on p.id = mp.person_id and p.archived_at is null
   where m.status in ('active', 'awaiting_payment', 'lapsed')
     and (m.payer_person_id = current_person_id() or (m.household_id is not null and is_household_lead(m.household_id)))
     and (
       (m.status <> 'lapsed' and club_today() between t.ends_on - renewal_notice_days() and t.ends_on)
       or (
         (t.ends_on < club_today() or m.status = 'lapsed')
         and not exists (select 1 from membership_people x
                           join memberships y on y.id = x.membership_id
                           join membership_types u on u.id = y.membership_type_id
                          where x.person_id = mp.person_id and y.status <> 'cancelled' and y.id <> m.id
                            and u.starts_on >= t.starts_on)
       )
     )
$$;

-- Renew: the type must start after the membership being renewed ends, and not have ended.
-- (So a lapsed member can renew onto a membership that is already running.)
create or replace function renew_my_membership(p_type_id uuid, p_person_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_person_id();
  mt membership_types;
  last_end date;
begin
  if me is null then raise exception 'Not logged in'; end if;
  if coalesce(cardinality(p_person_ids), 0) = 0 then raise exception 'Choose who the membership is for'; end if;
  if exists (select 1 from people p join households h on h.id = p.household_id
              where p.id = me and h.lead_person_id is distinct from me) then
    raise exception 'Only your family''s main contact can renew';
  end if;
  if exists (select 1 from unnest(p_person_ids) pid where pid not in (select r.person_id from my_renewals() r)) then
    raise exception 'Only people whose membership is due for renewal can be renewed';
  end if;
  select max(r.ends_on) into last_end from my_renewals() r where r.person_id = any(p_person_ids);
  select * into mt from membership_types
   where id = p_type_id and is_open and starts_on > last_end and ends_on >= club_today();
  if not found then raise exception 'Choose a membership type that starts after your current one'; end if;
  if mt.cover = 'family' and cardinality(p_person_ids) > 4 then
    raise exception '% covers up to 4 people', mt.name;
  end if;
  return create_membership(me, p_type_id, p_person_ids);
end $$;

create or replace function create_membership(p_payer uuid, p_type_id uuid, p_person_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  hh      uuid;
  mt      membership_types;
  juniors int;
  q       record;
  new_id  uuid;
begin
  select * into mt from membership_types where id = p_type_id and is_open and ends_on >= club_today();
  if not found then raise exception 'Membership type not available'; end if;
  if coalesce(cardinality(p_person_ids), 0) = 0 then raise exception 'Choose who the membership is for'; end if;

  select household_id into hh from people where id = p_payer;
  if exists (select 1 from unnest(p_person_ids) pid
             where pid <> p_payer and pid not in (select id from people where household_id = hh and hh is not null)) then
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
       and (date_of_birth is null or date_part('year', age(mt.starts_on, date_of_birth)) > mt.max_age)) then
    raise exception 'Someone is over the age limit for % (date of birth needed)', mt.name;
  end if;
  if mt.requires_adult_member and not exists (
       select 1 from memberships m
       join membership_types t on t.id = m.membership_type_id
       where m.household_id = hh and periods_overlap(t, mt)
         and t.cover <> 'junior' and m.status in ('active', 'awaiting_payment')) then
    raise exception 'A junior needs an adult in the household to hold a membership for the same dates';
  end if;

  -- Junior sibling pricing: count the household's junior memberships for the same dates, then use J1, J2 or J3.
  if mt.sibling_order is not null then
    select count(*) into juniors
      from memberships m join membership_types t on t.id = m.membership_type_id
     where m.household_id = hh and t.sibling_order is not null and periods_overlap(t, mt)
       and m.status <> 'cancelled';
    select * into mt from membership_types j
     where j.cover = 'junior' and j.is_open and j.starts_on = mt.starts_on and j.ends_on = mt.ends_on
       and j.sibling_order <= least(juniors + 1, 3)
     order by j.sibling_order desc, j.sort_order limit 1;
    if not found then raise exception 'Junior membership not available'; end if;
  end if;

  if exists (
       select 1 from memberships m
       join membership_people mp on mp.membership_id = m.id
       join membership_types t on t.id = m.membership_type_id
       where m.status <> 'cancelled' and mp.person_id = any(p_person_ids) and periods_overlap(t, mt)
         and (t.id = mt.id or (t.category = 'sailing' and mt.category = 'sailing'))) then
    raise exception 'Someone already has this kind of membership for those dates';
  end if;

  select * into q from membership_quote(mt.id);
  -- Pro rata is for brand-new members only. If anyone covered has had a membership before (even one
  -- that has lapsed), the full price applies.
  if exists (select 1 from membership_people mp join memberships m on m.id = mp.membership_id
              where mp.person_id = any(p_person_ids) and m.status <> 'cancelled') then
    select mt.annual_price_pence as price_pence,
           ((extract(year from mt.ends_on) - extract(year from mt.starts_on)) * 12
            + extract(month from mt.ends_on) - extract(month from mt.starts_on) + 1)::int as months
      into q;
  end if;

  insert into memberships (membership_type_id, payer_person_id, household_id, status, price_pence, prorata_months)
  values (mt.id, p_payer, hh, 'awaiting_payment', q.price_pence, q.months)
  returning id into new_id;

  insert into membership_people (membership_id, person_id)
  select new_id, unnest(p_person_ids);
  return new_id;
end $$;
revoke execute on function create_membership(uuid, uuid, uuid[]) from public, anon, authenticated;
