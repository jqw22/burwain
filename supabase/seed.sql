-- Burwain membership app: starting reference data (prices as supplied by James, 8 Nov 2026).

insert into activities (name) values ('Sailing'), ('Paddleboarding'), ('RC Laser sailing');

insert into membership_types
  (code, name, description, category, cover, annual_price_pence, max_age, requires_adult_member, requires_approval, sibling_order, sort_order)
values
  ('IS',  'Individual Sailing', 'Adult sailing member, excluding boat storage.', 'sailing', 'individual', 18500, null, false, false, null, 10),
  ('F',   'Family', 'The full family where children are under 18, or under 21 in full-time education or training. Excludes boat storage.', 'sailing', 'family', 25500, null, false, false, null, 20),
  ('D',   'Dual', 'Two adults of the same household who both sail, excluding boat storage.', 'sailing', 'dual', 22500, null, false, false, null, 30),
  ('U21', 'U21 Adult', 'Adult sailing member under 21, excluding boat storage.', 'sailing', 'individual', 9500, 20, false, false, null, 40),
  ('J1',  'Junior', 'Sailing member under 18. A parent must also be a member in an adult category.', 'sailing', 'junior', 9500, 17, true, false, 1, 50),
  ('J2',  'Junior (second sibling)', 'Second sibling in the same family.', 'sailing', 'junior', 7000, 17, true, false, 2, 60),
  ('J3',  'Junior (third sibling)', 'Third sibling in the same family.', 'sailing', 'junior', 5000, 17, true, false, 3, 70),
  ('C',   'Club Membership', 'For anyone with an interest in the Club.', 'non_sailing', 'individual', 3000, null, false, false, null, 80),
  ('A',   'Associate Membership', 'Full members of 5+ years who no longer sail, or members now living over 75 miles away. Needs admin approval.', 'non_sailing', 'individual', 3000, null, false, true, null, 90),
  ('RC',  'RC Laser Membership', 'Members who sail Remote Control Lasers only.', 'non_sailing', 'individual', 9500, null, false, false, null, 100),
  ('SUP', 'Stand Up Paddleboard', 'Covers the whole family for paddleboarding.', 'non_sailing', 'family', 8000, null, false, false, null, 110);

insert into membership_type_activities (membership_type_id, activity_id)
select t.id, a.id from membership_types t, activities a
 where (t.code in ('IS','F','D','U21','J1','J2','J3') and a.name = 'Sailing')
    or (t.code = 'RC'  and a.name = 'RC Laser sailing')
    or (t.code = 'SUP' and a.name = 'Paddleboarding');

insert into club_years (label, starts_on, ends_on) values
  ('2026', '2026-01-01', '2026-12-31'),
  ('2027', '2027-01-01', '2027-12-31');

insert into boat_storage_options (name, price_pence, members_rate, description) values
  ('Dinghy storage (members)', 3500, true,  'Per sailing dinghy, including road trailer.'),
  ('Dinghy storage (non-members)', 8000, false, 'Per dinghy. Non-sailing owners can join as Club or Associate and pay the members rate.');

insert into transaction_categories (name, direction) values
  ('Subscriptions', 'in'), ('Boat storage', 'in'), ('Events', 'in'), ('Donations', 'in'), ('Other income', 'in'),
  ('Payment fees', 'out'), ('Equipment', 'out'), ('Insurance', 'out'), ('Venue', 'out'),
  ('Events costs', 'out'), ('Affiliations', 'out'), ('Other costs', 'out');
