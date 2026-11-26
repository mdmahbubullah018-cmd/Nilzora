-- ---------------------------------------------------------------------------
-- "Set stock" needs its own ledger reason
--
-- `inventory_movements.reason` is the enum public.inventory_reason. The previous
-- migration added admin_set_variant_stock(), which writes 'stock_set'; the enum did not
-- have that label yet, so the function failed (22P02) until this value existed.
--
-- Additive: one new enum label. Existing rows and labels are untouched.
-- ---------------------------------------------------------------------------

alter type public.inventory_reason add value if not exists 'stock_set';
