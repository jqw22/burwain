-- Transaction categories are managed on the Categories screen (Finance admin).
-- Like membership types, categories are never deleted: they're made inactive instead,
-- so old transactions keep their category but it isn't offered for new ones.
alter table transaction_categories add column is_active boolean not null default true;

-- Member payments find these categories by name, so they can't be renamed or made inactive.
create function protect_system_categories() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.name in ('Subscriptions', 'Boat storage', 'Payment fees')
     and (new.name <> old.name or not new.is_active or new.direction <> old.direction) then
    raise exception '% is used automatically for member payments and can''t be changed', old.name;
  end if;
  return new;
end $$;
create trigger protect_system_categories before update on transaction_categories
  for each row execute function protect_system_categories();
