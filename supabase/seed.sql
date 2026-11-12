-- Burwain membership app: starting reference data (prices as supplied by James, 8 Nov 2026).

insert into activities (name) values ('Sailing'), ('Paddleboarding'), ('RC Laser sailing');

insert into club_years (label, starts_on, ends_on) values
  ('2026', '2026-01-01', '2026-12-31'),
  ('2027', '2027-01-01', '2027-12-31');

-- 2026 membership types (1 Jan to 31 Dec 2026). 2027 starts as a copy (below).
insert into membership_types
  (starts_on, ends_on, code, name, description, category, cover, annual_price_pence, max_age, requires_adult_member, sibling_order, sort_order)
values
  ('2026-01-01', '2026-12-31', 'IS',  'Individual Sailing', 'Adult sailing member, excluding boat storage.', 'sailing', 'individual', 18500, null, false, null, 10),
  ('2026-01-01', '2026-12-31', 'F',   'Family', 'The full family where children are under 18, or under 21 in full-time education or training. Excludes boat storage.', 'sailing', 'family', 25500, null, false, null, 20),
  ('2026-01-01', '2026-12-31', 'D',   'Dual', 'Two adults of the same household who both sail, excluding boat storage.', 'sailing', 'dual', 22500, null, false, null, 30),
  ('2026-01-01', '2026-12-31', 'U21', 'U21 Adult', 'Adult sailing member under 21, excluding boat storage.', 'sailing', 'individual', 9500, 20, false, null, 40),
  ('2026-01-01', '2026-12-31', 'J1',  'Junior', 'Sailing member under 18. A parent must also be a member in an adult category.', 'sailing', 'junior', 9500, 17, true, 1, 50),
  ('2026-01-01', '2026-12-31', 'J2',  'Junior (second sibling)', 'Second sibling in the same family.', 'sailing', 'junior', 7000, 17, true, 2, 60),
  ('2026-01-01', '2026-12-31', 'J3',  'Junior (third sibling)', 'Third sibling in the same family.', 'sailing', 'junior', 5000, 17, true, 3, 70),
  ('2026-01-01', '2026-12-31', 'C',   'Club Membership', 'For anyone with an interest in the Club.', 'non_sailing', 'individual', 3000, null, false, null, 80),
  ('2026-01-01', '2026-12-31', 'A',   'Associate Membership', 'Full members of 5+ years who no longer sail, or members now living over 75 miles away.', 'non_sailing', 'individual', 3000, null, false, null, 90),
  ('2026-01-01', '2026-12-31', 'RC',  'RC Laser Membership', 'Members who sail Remote Control Lasers only.', 'non_sailing', 'individual', 9500, null, false, null, 100),
  ('2026-01-01', '2026-12-31', 'SUP', 'Stand Up Paddleboard', 'Covers the whole family for paddleboarding.', 'non_sailing', 'family', 8000, null, false, null, 110);

insert into membership_type_activities (membership_type_id, activity_id)
select t.id, a.id from membership_types t, activities a
 where (t.code in ('IS','F','D','U21','J1','J2','J3') and a.name = 'Sailing')
    or (t.code = 'RC'  and a.name = 'RC Laser sailing')
    or (t.code = 'SUP' and a.name = 'Paddleboarding');

-- 2027 starts with the same types and prices, so renewals can be tested.
insert into membership_types (starts_on, ends_on, code, name, description, category, cover, annual_price_pence,
                              max_age, requires_adult_member, sibling_order, is_open, sort_order)
select '2027-01-01', '2027-12-31', code, name, description, category, cover, annual_price_pence,
       max_age, requires_adult_member, sibling_order, is_open, sort_order
  from membership_types where starts_on = '2026-01-01';
insert into membership_type_activities (membership_type_id, activity_id)
select n.id, a.activity_id from membership_types n
  join membership_types o on o.code = n.code and o.starts_on = '2026-01-01'
  join membership_type_activities a on a.membership_type_id = o.id
 where n.starts_on = '2027-01-01';

insert into boat_storage_options (name, price_pence, members_rate, description) values
  ('Dinghy storage (members)', 3500, true,  'Per sailing dinghy, including road trailer.'),
  ('Dinghy storage (non-members)', 8000, false, 'Per dinghy. Non-sailing owners can join as Club or Associate and pay the members rate.');

insert into transaction_categories (name, direction) values
  ('Subscriptions', 'in'), ('Boat storage', 'in'), ('Events', 'in'), ('Donations', 'in'), ('Other income', 'in'),
  ('Payment fees', 'out'), ('Equipment', 'out'), ('Insurance', 'out'), ('Venue', 'out'),
  ('Events costs', 'out'), ('Affiliations', 'out'), ('Other costs', 'out');
