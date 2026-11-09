-- Renewal reminder emails: who should get one, and a log of what was sent.
-- A reminder goes to the person who renews: the family's main contact, or the payer if not in a family.

alter table email_campaigns rename column body_html to body;
alter table email_campaigns
  add column purpose      text not null default 'general' check (purpose in ('renewal_reminder', 'general')),
  add column template_id  uuid references email_templates (id) on delete set null,
  add column club_year_id uuid references club_years (id);

alter table email_recipients
  add column sent_at timestamptz,
  add column error   text,
  add constraint email_recipients_status check (status in ('queued', 'sent', 'failed'));

-- People who still need to renew for p_club_year_id: this year's memberships with someone not yet
-- covered next year, grouped by the person who renews.
create function renewal_reminder_recipients(p_club_year_id uuid)
returns table (person_id uuid, first_name text, last_name text, email text, membership_types text,
               renewal_price_pence integer, last_reminded_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role('admin') then raise exception 'Admins only'; end if;
  return query
  with next_year as (
    select cy.id, cy.starts_on from club_years cy where cy.id = p_club_year_id
  ), this_year as (
    select cy.id from club_years cy, next_year n
     where cy.ends_on < n.starts_on order by cy.ends_on desc limit 1
  ), covered as (
    select mp.person_id from membership_people mp join memberships m on m.id = mp.membership_id
     where m.club_year_id = p_club_year_id and m.status <> 'cancelled'
  ), due as (
    select m.id, m.membership_type_id,
           coalesce(h.lead_person_id, m.payer_person_id) as renewer
      from memberships m
      join this_year ty on ty.id = m.club_year_id
      left join households h on h.id = m.household_id
     where m.status in ('active', 'awaiting_payment', 'pending_approval')
       and exists (select 1 from membership_people mp join people p on p.id = mp.person_id
                    where mp.membership_id = m.id and p.archived_at is null
                      and mp.person_id not in (select c.person_id from covered c))
  )
  select p.id, p.first_name, p.last_name, p.email,
         string_agg(t.name, ', ' order by t.sort_order),
         sum(t.annual_price_pence)::int,
         (select max(r.sent_at) from email_recipients r join email_campaigns c on c.id = r.campaign_id
           where r.person_id = p.id and r.status = 'sent' and c.purpose = 'renewal_reminder'
             and c.club_year_id = p_club_year_id)
    from due d
    join people p on p.id = d.renewer and p.archived_at is null
    join membership_types t on t.id = d.membership_type_id
   group by p.id, p.first_name, p.last_name, p.email
   order by p.last_name, p.first_name;
end $$;
revoke execute on function renewal_reminder_recipients(uuid) from public, anon;
grant execute on function renewal_reminder_recipients(uuid) to authenticated;
