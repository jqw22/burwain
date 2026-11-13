-- Renewal reminders can also go to lapsed members: for 90 days after their membership ended
-- (the same window in which the Members list shows their renewal as Outstanding).
-- The expected price is the next type with the same code starting after theirs ended.

create or replace function renewal_reminder_recipients(p_template_id uuid default null)
returns table (person_id uuid, first_name text, last_name text, email text, membership_types text,
               renewal_price_pence integer, last_reminded_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role('admin') then raise exception 'Admins only'; end if;
  return query
  with due as (
    select m.id, m.membership_type_id, t.ends_on,
           coalesce(h.lead_person_id, m.payer_person_id) as renewer
      from memberships m
      join membership_types t on t.id = m.membership_type_id
      left join households h on h.id = m.household_id
     where m.status in ('active', 'awaiting_payment', 'lapsed')
       -- From the renewal notice before it ends until 90 days after it ended (lapsed members,
       -- matching the Members list's Renewal column); a membership marked lapsed early counts too.
       and club_today() <= t.ends_on + 90
       and (club_today() >= t.ends_on - renewal_notice_days() or m.status = 'lapsed')
       and exists (select 1 from membership_people mp join people p on p.id = mp.person_id
                    where mp.membership_id = m.id and p.archived_at is null
                      and not exists (select 1 from membership_people x
                                        join memberships y on y.id = x.membership_id
                                        join membership_types u on u.id = y.membership_type_id
                                       where x.person_id = mp.person_id and y.status <> 'cancelled'
                                         and u.starts_on > t.starts_on))
  )
  select p.id, p.first_name, p.last_name, p.email,
         string_agg(t.name, ', ' order by t.sort_order),
         sum(coalesce((select nt.annual_price_pence from membership_types nt
                        where nt.code = t.code and nt.is_open and nt.starts_on > t.ends_on
                        order by nt.starts_on limit 1), t.annual_price_pence))::int,
         (select max(r.sent_at) from email_recipients r join email_campaigns c on c.id = r.campaign_id
           where r.person_id = p.id and r.status = 'sent' and c.purpose = 'renewal_reminder'
             and (p_template_id is null or c.template_id = p_template_id)
             and r.sent_at >= min(d.ends_on) - renewal_notice_days())
    from due d
    join people p on p.id = d.renewer and p.archived_at is null
    join membership_types t on t.id = d.membership_type_id
   group by p.id, p.first_name, p.last_name, p.email
   order by p.last_name, p.first_name;
end $$;
