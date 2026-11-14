-- Actual screen (James, 2026-11-14): the Budget layout, showing actual figures from Transactions
-- for months finance has marked complete, and the budget figures for the other months.
-- Months marked complete are stored here; ticking the box in the month header adds a row.
create table budget_months_complete (
  year         integer not null check (year between 2000 and 2100),
  month        integer not null check (month between 1 and 12),
  completed_at timestamptz not null default now(),
  completed_by uuid references people (id) on delete set null default current_person_id(),
  primary key (year, month)
);
create trigger audit after insert or update or delete on budget_months_complete
  for each row execute function audit_row();
alter table budget_months_complete enable row level security;
create policy bmc_read   on budget_months_complete for select to authenticated using (has_role('finance') or has_role('admin'));
create policy bmc_insert on budget_months_complete for insert to authenticated with check (has_role('finance'));
create policy bmc_delete on budget_months_complete for delete to authenticated using (has_role('finance'));

-- Mark a month complete or not. Finance only.
create function set_budget_month_complete(p_year integer, p_month integer, p_complete boolean) returns void
language plpgsql set search_path = public as $$
begin
  if not has_role('finance') then raise exception 'Only finance logins can mark months complete'; end if;
  if p_complete then
    insert into budget_months_complete (year, month) values (p_year, p_month) on conflict do nothing;
  else
    delete from budget_months_complete where year = p_year and month = p_month;
  end if;
end $$;
revoke execute on function set_budget_month_complete(integer, integer, boolean) from public, anon;
grant execute on function set_budget_month_complete(integer, integer, boolean) to authenticated;

-- Actual amount per category per month of a year, from Transactions. Money the "wrong" way for a
-- category (e.g. a refund out of an income category) reduces it. Finance and admins only.
create function budget_actuals(p_year integer)
returns table (category_id uuid, month integer, amount_pence bigint)
language sql stable security definer set search_path = public as $$
  select t.category_id, extract(month from t.occurred_on)::integer,
         sum(case when t.direction = c.direction then t.amount_pence else -t.amount_pence end)
    from transactions t
    join transaction_categories c on c.id = t.category_id
   where extract(year from t.occurred_on) = p_year
     and (has_role('finance') or has_role('admin'))
   group by 1, 2
$$;
revoke execute on function budget_actuals(integer) from public, anon;
grant execute on function budget_actuals(integer) to authenticated;
