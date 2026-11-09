-- The family's main contact manages every family member's details, including their medical
-- information and qualifications (contact details were already allowed).

create function can_manage_family_member(p_person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from people p
     where p.id = p_person
       and p.id <> current_person_id()
       and p.household_id is not null
       and is_household_lead(p.household_id))
$$;

revoke execute on function can_manage_family_member(uuid) from public, anon;
grant execute on function can_manage_family_member(uuid) to authenticated;

create policy medical_family on medical_records for all to authenticated
  using (can_manage_family_member(person_id)) with check (can_manage_family_member(person_id));

create policy quals_family on qualifications for all to authenticated
  using (can_manage_family_member(person_id)) with check (can_manage_family_member(person_id));
