-- Budget: a planned amount for each transaction category in each month of a calendar year.
-- Finance logins enter the figures on the Budget screen; admins can look but not change them.
-- A blank cell has no row.
create table budget_amounts (
  year         integer not null check (year between 2000 and 2100),
  category_id  uuid not null references transaction_categories (id),
  month        integer not null check (month between 1 and 12),
  amount_pence integer not null check (amount_pence >= 0),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references people (id) on delete set null,
  primary key (year, category_id, month)
);

-- Record who last changed each figure.
create function budget_amounts_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := current_person_id();
  return new;
end $$;
create trigger budget_amounts_stamp before insert or update on budget_amounts
  for each row execute function budget_amounts_stamp();
create trigger audit after insert or update or delete on budget_amounts
  for each row execute function audit_row();

alter table budget_amounts enable row level security;
create policy budget_read   on budget_amounts for select to authenticated using (has_role('finance') or has_role('admin'));
create policy budget_insert on budget_amounts for insert to authenticated with check (has_role('finance'));
create policy budget_update on budget_amounts for update to authenticated using (has_role('finance')) with check (has_role('finance'));
create policy budget_delete on budget_amounts for delete to authenticated using (has_role('finance'));

-- Save the Budget screen in one go. p_cells is a list of {category_id, month, amount_pence};
-- a null or zero amount clears that cell. Runs as the signed-in user, so only finance can save.
create function save_budget(p_year integer, p_cells jsonb) returns void
language plpgsql set search_path = public as $$
begin
  if not has_role('finance') then
    raise exception 'Only finance logins can change the budget';
  end if;

  delete from budget_amounts b
   using jsonb_to_recordset(p_cells) as c(category_id uuid, month integer, amount_pence integer)
   where b.year = p_year and b.category_id = c.category_id and b.month = c.month
     and coalesce(c.amount_pence, 0) = 0;

  insert into budget_amounts (year, category_id, month, amount_pence)
  select p_year, c.category_id, c.month, c.amount_pence
    from jsonb_to_recordset(p_cells) as c(category_id uuid, month integer, amount_pence integer)
   where coalesce(c.amount_pence, 0) <> 0
  on conflict (year, category_id, month) do update
    set amount_pence = excluded.amount_pence
    where budget_amounts.amount_pence is distinct from excluded.amount_pence;
end $$;
revoke execute on function save_budget(integer, jsonb) from anon;
