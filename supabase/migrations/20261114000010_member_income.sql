-- Income screen (James, 2026-11-14): every payment received from members in one list, with a
-- date range and search like Transactions. One row per line of a paid member receipt (a
-- membership or a boat), with who paid and who the membership covers. Finance and admins only.
create function member_income(p_from date, p_to date)
returns table (id uuid, paid_on date, payer_name text, description text, kind text, covers text,
               method payment_method, amount_pence integer, receipt_id uuid)
language sql stable security definer set search_path = public as $$
  select rl.id, r.paid_on,
         nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
         rl.description,
         case when rl.boat_storage_id is not null then 'Boat storage'
              when rl.membership_id is not null then 'Membership' else 'Other' end,
         (select string_agg(cp.first_name || ' ' || cp.last_name, ', ' order by cp.date_of_birth nulls first)
            from membership_people mp join people cp on cp.id = mp.person_id
           where mp.membership_id = rl.membership_id),
         r.method, rl.amount_pence, r.id
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
