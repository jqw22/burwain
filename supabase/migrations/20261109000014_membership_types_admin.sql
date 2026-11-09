-- Club admins (not just the superadmin) can add membership types, edit them and make them
-- active or inactive. Types are never deleted, because past memberships point at them:
-- an inactive type isn't offered to new members, on the Join page or for renewal.

drop policy mt_write on membership_types;
create policy mt_insert on membership_types for insert to authenticated with check (has_role('admin'));
create policy mt_update on membership_types for update to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy mt_delete on membership_types for delete to authenticated using (has_role('superadmin'));

alter table membership_types
  add constraint membership_types_name_present check (length(trim(name)) > 0),
  add constraint membership_types_code_format check (code ~ '^[A-Z0-9]{1,10}$'),
  add constraint membership_types_max_age_range check (max_age is null or max_age between 0 and 120),
  add constraint membership_types_sibling_order_range check (sibling_order is null or sibling_order between 1 and 9);
