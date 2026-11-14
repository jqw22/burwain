-- Finance list (James, 2026-11-14):
--   1. A fixed "Transfer from Saving" category (money in). On the Budget and Actual sheets it has
--      its own row between Total and Cumulative balance, so it isn't counted as income.
--   2. Only finance logins can rename categories or make them inactive (already true through the
--      row security policy; this states it in the trigger too, so the rule holds whoever runs it).
--   3. Income screen: finance ticks "Reconciled" on each payment line once the money is in the bank
--      and entered as a transaction.

insert into transaction_categories (name, direction) values ('Transfer from Saving', 'in')
on conflict (name) do nothing;

create or replace function protect_system_categories() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.name <> old.name or new.is_active <> old.is_active or new.direction <> old.direction)
     and current_user not in ('postgres', 'supabase_admin') and not has_role('finance') then
    raise exception 'Only finance logins can change categories';
  end if;
  if old.name in ('Subscriptions', 'Boat storage', 'Payment fees', 'Transfer from Saving')
     and (new.name <> old.name or not new.is_active or new.direction <> old.direction) then
    raise exception '% is a fixed category and can''t be changed', old.name;
  end if;
  return new;
end $$;

alter table member_receipt_lines
  add column reconciled_at timestamptz,
  add column reconciled_by uuid references people (id) on delete set null;

create function set_receipt_line_reconciled(p_line uuid, p_reconciled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('finance') then raise exception 'Only finance logins can reconcile payments'; end if;
  update member_receipt_lines
     set reconciled_at = case when p_reconciled then coalesce(reconciled_at, now()) end,
         reconciled_by = case when p_reconciled then coalesce(reconciled_by, current_person_id()) end
   where id = p_line;
end $$;
revoke execute on function set_receipt_line_reconciled(uuid, boolean) from public, anon;
grant execute on function set_receipt_line_reconciled(uuid, boolean) to authenticated;

-- Income list: now also says whether each line is reconciled.
drop function member_income(date, date);
create function member_income(p_from date, p_to date)
returns table (id uuid, paid_on date, payer_name text, description text, kind text, covers text,
               method payment_method, amount_pence integer, receipt_id uuid, reconciled_at timestamptz)
language sql stable security definer set search_path = public as $$
  select rl.id, r.paid_on,
         nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
         rl.description,
         case when rl.boat_storage_id is not null then 'Boat storage'
              when rl.membership_id is not null then 'Membership' else 'Other' end,
         (select string_agg(cp.first_name || ' ' || cp.last_name, ', ' order by cp.date_of_birth nulls first)
            from membership_people mp join people cp on cp.id = mp.person_id
           where mp.membership_id = rl.membership_id),
         r.method, rl.amount_pence, r.id, rl.reconciled_at
    from member_receipt_lines rl
    join member_receipts r on r.id = rl.receipt_id
    left join people p on p.id = r.payer_person_id
   where r.status = 'paid'
     and (has_role('finance') or has_role('admin'))
     and (p_from is null or r.paid_on >= p_from)
     and (p_to is null or r.paid_on <= p_to)
   order by r.paid_on, r.created_at, rl.id
$$;
revoke execute on function member_income(date, date) from public, anon;
grant execute on function member_income(date, date) to authenticated;
