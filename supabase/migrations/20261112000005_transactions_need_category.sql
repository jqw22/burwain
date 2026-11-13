-- Every new transaction must have a category (James, 2026-11-12).
-- NOT VALID: the rule applies to new and changed rows; any older uncategorised test rows are left alone.
alter table transactions add constraint transactions_category_required check (category_id is not null) not valid;
