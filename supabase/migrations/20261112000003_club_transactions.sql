-- Transactions screen (Finance admin): every money-in and money-out record between two dates,
-- with who paid (for member receipts) and a running balance, oldest first (seq is the running order).
-- The balance runs over all transactions from the very first one, starting from zero,
-- so a row's balance is the same whichever dates are being viewed.
-- Finance logins can't read the people table, so this runs as a security definer and checks the role itself.
create function club_transactions(p_from date, p_to date)
returns table (id uuid, occurred_on date, description text, direction txn_direction, amount_pence integer,
               method payment_method, category text, paid_by text, is_correction boolean, balance_pence bigint, seq bigint)
language sql stable security definer set search_path = public as $$
  select * from (
    select tx.id, tx.occurred_on, tx.description, tx.direction, tx.amount_pence, tx.method,
           c.name as category, nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as paid_by,
           tx.reverses_id is not null as is_correction,
           sum(case tx.direction when 'in' then tx.amount_pence else -tx.amount_pence end)
             over (order by tx.occurred_on, tx.created_at, tx.id) as balance_pence,
           row_number() over (order by tx.occurred_on, tx.created_at, tx.id) as seq
      from transactions tx
      left join transaction_categories c on c.id = tx.category_id
      left join member_receipt_lines rl on rl.id = tx.receipt_line_id
      left join member_receipts r on r.id = rl.receipt_id
      left join people p on p.id = r.payer_person_id
     where has_role('finance') or has_role('admin')
  ) t
  where t.occurred_on between coalesce(p_from, '-infinity'::date) and coalesce(p_to, 'infinity'::date)
  order by t.seq
$$;
revoke execute on function club_transactions(date, date) from public, anon;
grant execute on function club_transactions(date, date) to authenticated;
