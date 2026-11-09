-- The family's main contact can add medical information for family members who can't manage
-- their own: juniors (under 18) and anyone without their own login yet. Adults who sign in
-- themselves keep sole control of their own record.

create function can_manage_family_medical(p_person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from people p
     where p.id = p_person
       and p.id <> current_person_id()
       and p.household_id is not null
       and is_household_lead(p.household_id)
       and (p.auth_user_id is null or p.date_of_birth > current_date - interval '18 years'))
$$;

revoke execute on function can_manage_family_medical(uuid) from public, anon;
grant execute on function can_manage_family_medical(uuid) to authenticated;

create policy medical_family on medical_records for all to authenticated
  using (can_manage_family_medical(person_id)) with check (can_manage_family_medical(person_id));
