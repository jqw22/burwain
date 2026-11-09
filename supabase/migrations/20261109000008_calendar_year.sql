-- The club year now runs with the calendar year: 1 January to 31 December.
-- Existing years keep their memberships and move to the calendar year they start in
-- (2026/27 becomes 2026, 2027/28 becomes 2027). Renewals still open 60 days before the year starts.

update club_years
   set label     = extract(year from starts_on)::int::text,
       starts_on = make_date(extract(year from starts_on)::int, 1, 1),
       ends_on   = make_date(extract(year from starts_on)::int, 12, 31);

comment on table club_years is 'Club year: 1 January to 31 December, labelled by the year (e.g. 2026).';

-- Months left in the club year, counting the joining month (January = 12 ... December = 1).
create or replace function prorata_months(join_date date) returns integer
language sql immutable set search_path = public as $$
  select 13 - extract(month from join_date)::int
$$;
