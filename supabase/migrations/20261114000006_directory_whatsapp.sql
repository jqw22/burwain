-- Directory: also say whether each person is happy to be contacted on WhatsApp,
-- so the app only shows a WhatsApp chat button for people who opted in.
drop function member_directory();
create function member_directory()
returns table (id uuid, first_name text, last_name text, mobile text, email text, membership text, whatsapp boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, p.mobile, p.email,
         string_agg(distinct t.name, ', '), p.whatsapp
    from people p
    join membership_people mp on mp.person_id = p.id
    join memberships m on m.id = mp.membership_id
    join membership_types t on t.id = m.membership_type_id
   where t.ends_on >= club_today()
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
