-- Category order (James, 2026-11-16): finance sets the order categories appear in on the Budget and
-- Actual sheets (and the Categories screen and Add transaction list). In Money in, Subscriptions and
-- Boat storage are always 1 and 2. Money in and Money out are numbered separately.
alter table transaction_categories add column sort_order integer;

-- Starting order: Subscriptions, Boat storage, then the rest alphabetically (active before inactive).
update transaction_categories c set sort_order = o.n
  from (select id, row_number() over (
          partition by direction
          order by case name when 'Subscriptions' then 1 when 'Boat storage' then 2 else 3 end,
                   not is_active, name) as n
          from transaction_categories) o
 where o.id = c.id;
alter table transaction_categories alter column sort_order set not null;

-- New categories go to the bottom of their list (Subscriptions and Boat storage, if ever added
-- afresh, go to 1 and 2 and the others move down).
create function transaction_categories_new_order() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.name in ('Subscriptions', 'Boat storage') then
    new.sort_order := case new.name when 'Subscriptions' then 1 else 2 end;
    update transaction_categories set sort_order = sort_order + 1
     where direction = new.direction and sort_order >= new.sort_order;
  elsif new.sort_order is null then
    select coalesce(max(sort_order), 0) + 1 into new.sort_order
      from transaction_categories where direction = new.direction;
  end if;
  return new;
end $$;
create trigger transaction_categories_new_order before insert on transaction_categories
  for each row execute function transaction_categories_new_order();

-- Move a category one place up (-1) or down (+1) in its list, swapping with its neighbour.
-- Subscriptions and Boat storage stay at the top. Runs as the signed-in user: finance only.
create function move_category(p_id uuid, p_step integer) returns void
language plpgsql set search_path = public as $$
declare
  me transaction_categories;
  other transaction_categories;
begin
  if not has_role('finance') then
    raise exception 'Only finance logins can change categories';
  end if;
  select * into me from transaction_categories where id = p_id;
  if me.id is null then raise exception 'No such category'; end if;
  if me.name in ('Subscriptions', 'Boat storage') then
    raise exception '% always comes first', me.name;
  end if;
  select * into other from transaction_categories
   where direction = me.direction and id <> me.id
     and case when p_step < 0 then sort_order < me.sort_order else sort_order > me.sort_order end
   order by case when p_step < 0 then -sort_order else sort_order end
   limit 1;
  if other.id is null or other.name in ('Subscriptions', 'Boat storage') then
    return; -- already at the top or bottom
  end if;
  update transaction_categories set sort_order = other.sort_order where id = me.id;
  update transaction_categories set sort_order = me.sort_order where id = other.id;
end $$;
revoke execute on function move_category(uuid, integer) from public, anon;
grant execute on function move_category(uuid, integer) to authenticated;
