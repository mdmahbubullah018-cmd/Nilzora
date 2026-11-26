-- Discount campaigns: the effective price resolution, that a product's own sale price is
-- never overwritten and comes back on its own, the precedence between overlapping
-- campaigns, the coupon policy, order snapshots, the permission gates and the
-- concurrency check that stops one administrator overwriting another's edit.
-- Fixtures use a `zd-` namespace and fixed ids; everything runs in a transaction that is
-- rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(57);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000e1', 'zd-owner@example.com', now()),
  ('00000000-0000-4000-8000-0000000000e2', 'zd-admin@example.com', now()),
  ('00000000-0000-4000-8000-0000000000e3', 'zd-staff@example.com', now()),
  ('00000000-0000-4000-8000-0000000000e4', 'zd-buyer@example.com', now());

update public.user_roles set role = 'super_admin' where user_id = '00000000-0000-4000-8000-0000000000e1';
update public.user_roles set role = 'admin' where user_id = '00000000-0000-4000-8000-0000000000e2';
update public.user_roles set role = 'staff' where user_id = '00000000-0000-4000-8000-0000000000e3';
update public.user_roles set role = 'customer' where user_id = '00000000-0000-4000-8000-0000000000e4';

insert into public.delivery_charges (zone, amount_minor) values ('inside_dhaka', 6000)
  on conflict (zone) do update set amount_minor = excluded.amount_minor;

insert into public.addresses (id, user_id, recipient_name, phone, division, district, area, address_line)
values ('ad000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e4',
        'ZD Buyer', '+8801712345678', 'Dhaka', 'Dhaka', 'Dhanmondi', 'House 1, Road 1');

insert into public.categories (id, slug, name, is_active, parent_id) values
  ('ca000000-0000-4000-8000-0000000000e1', 'zd-dept', 'ZD Department', true, null),
  ('ca000000-0000-4000-8000-0000000000e2', 'zd-sub', 'ZD Subcategory', true,
   'ca000000-0000-4000-8000-0000000000e1'),
  ('ca000000-0000-4000-8000-0000000000e3', 'zd-other', 'ZD Other', true, null);

insert into public.brands (id, slug, name, is_active) values
  ('b0000000-0000-4000-8000-0000000000e1', 'zd-nike', 'ZD Nike', true);

-- pp1: list 1000.00, sold at 800.00 — the product-level discount the campaign must override.
-- pp2: list 1500.00, no product-level discount.
-- pp3: list 2500.00, sold at 2000.00, in the brand.
insert into public.products
  (id, category_id, brand_id, slug, sku, name, price_minor, compare_at_price_minor,
   stock_quantity, status, moderation_status)
values
  ('0d000000-0000-4000-8000-0000000000e1', 'ca000000-0000-4000-8000-0000000000e2', null,
   'zd-tee', 'ZD-TEE', 'ZD Tee', 80000, 100000, 20, 'active', 'approved'),
  ('0d000000-0000-4000-8000-0000000000e2', 'ca000000-0000-4000-8000-0000000000e1', null,
   'zd-polo', 'ZD-POLO', 'ZD Polo', 150000, null, 20, 'active', 'approved'),
  ('0d000000-0000-4000-8000-0000000000e3', 'ca000000-0000-4000-8000-0000000000e2',
   'b0000000-0000-4000-8000-0000000000e1', 'zd-nike-tee', 'ZD-NIKE-TEE', 'ZD Nike Tee',
   200000, 250000, 20, 'active', 'approved'),
  ('0d000000-0000-4000-8000-0000000000e4', 'ca000000-0000-4000-8000-0000000000e2', null,
   'zd-draft', 'ZD-DRAFT', 'ZD Draft', 10000, null, 20, 'draft', 'approved');

-- A 30% campaign on the parent category: it must reach the product in its subcategory.
insert into public.discount_campaigns
  (id, name, customer_title, scope, discount_kind, discount_value, status, is_visible)
values ('cc000000-0000-4000-8000-0000000000e1', 'ZD Winter', 'ZD Winter Sale',
        'categories', 'percent', 30, 'active', true);

insert into public.discount_campaign_categories (campaign_id, category_id)
values ('cc000000-0000-4000-8000-0000000000e1', 'ca000000-0000-4000-8000-0000000000e1');

-- ---------------------------------------------------------------------------
-- 1. A campaign controls the price without touching the product
-- ---------------------------------------------------------------------------

select is(
  (select price_minor from public.catalog_products('zd-sub') where slug = 'zd-tee'),
  70000::bigint,
  '30% off takes the list price of 1000.00 to 700.00'
);
select is(
  (select compare_at_price_minor from public.catalog_products('zd-sub') where slug = 'zd-tee'),
  100000::bigint,
  'the struck-through price is the list price, not the old sale price'
);
select is(
  (select campaign_title from public.catalog_products('zd-sub') where slug = 'zd-tee'),
  'ZD Winter Sale',
  'the card says which campaign priced it'
);
select is(
  (select price_minor from public.products where slug = 'zd-tee'),
  80000::bigint,
  'the product keeps its own sale price while the campaign runs'
);
select is(
  (select compare_at_price_minor from public.products where slug = 'zd-tee'),
  100000::bigint,
  'and keeps its list price'
);
select is(
  (select price_minor from public.catalog_products(null, null, 'featured', 24, 0, array['zd-dept','zd-sub']) where slug = 'zd-polo'),
  105000::bigint,
  'a product with no discount of its own pays 30% of 1500.00'
);
select is(
  (select count(*)::int from public.catalog_products('zd-sub') where slug = 'zd-draft'),
  0,
  'a draft product is never listed or priced'
);

-- ---------------------------------------------------------------------------
-- 2. Pausing, ending and expiring restore the product-level discount by themselves
-- ---------------------------------------------------------------------------

update public.discount_campaigns set status = 'paused'
 where id = 'cc000000-0000-4000-8000-0000000000e1';

select is(
  (select price_minor from public.catalog_products('zd-sub') where slug = 'zd-tee'),
  80000::bigint,
  'pausing the campaign brings the product sale price back'
);
select is(
  (select compare_at_price_minor from public.catalog_products('zd-sub') where slug = 'zd-tee'),
  100000::bigint,
  'with its own struck-through price'
);
select is(
  (select campaign_title from public.catalog_products('zd-sub') where slug = 'zd-tee'),
  null::text,
  'and no campaign is named'
);

update public.discount_campaigns set status = 'ended', ended_at = now()
 where id = 'cc000000-0000-4000-8000-0000000000e1';

select is(
  (select price_minor from public.catalog_products('zd-sub') where slug = 'zd-tee'),
  80000::bigint,
  'an ended campaign changes nothing'
);

-- An "active" campaign whose window has already closed must not apply either: pricing
-- never depends on a scheduled job having run.
update public.discount_campaigns
   set status = 'active', ended_at = null, ends_at = now() - interval '1 minute'
 where id = 'cc000000-0000-4000-8000-0000000000e1';

select is(
  (select price_minor from public.catalog_products('zd-sub') where slug = 'zd-tee'),
  80000::bigint,
  'a campaign past its end instant stops applying on its own'
);

-- A scheduled campaign that has not started yet does not apply.
update public.discount_campaigns
   set status = 'scheduled', ends_at = null, starts_at = now() + interval '1 day'
 where id = 'cc000000-0000-4000-8000-0000000000e1';

select is(
  (select price_minor from public.catalog_products('zd-sub') where slug = 'zd-tee'),
  80000::bigint,
  'a campaign that has not started does not apply'
);

update public.discount_campaigns set starts_at = now() - interval '1 hour'
 where id = 'cc000000-0000-4000-8000-0000000000e1';

select is(
  (select price_minor from public.catalog_products('zd-sub') where slug = 'zd-tee'),
  70000::bigint,
  'the same campaign applies once its start has passed, with no job'
);

-- ---------------------------------------------------------------------------
-- 3. Fixed discounts, caps and the price floor
-- ---------------------------------------------------------------------------

update public.discount_campaigns
   set discount_kind = 'fixed', discount_value = 30000, max_discount_minor = null
 where id = 'cc000000-0000-4000-8000-0000000000e1';

select is(
  (select price_minor from public.catalog_products('zd-sub') where slug = 'zd-tee'),
  70000::bigint,
  'a fixed 300.00 off takes 1000.00 to 700.00'
);

update public.discount_campaigns
   set discount_kind = 'percent', discount_value = 50, max_discount_minor = 20000
 where id = 'cc000000-0000-4000-8000-0000000000e1';

select is(
  (select price_minor from public.catalog_products('zd-sub') where slug = 'zd-tee'),
  80000::bigint,
  'a maximum discount caps a percentage: 50% off 1000.00 capped at 200.00'
);

update public.discount_campaigns
   set discount_kind = 'fixed', discount_value = 1000000, max_discount_minor = null
 where id = 'cc000000-0000-4000-8000-0000000000e1';

select is(
  (select price_minor from public.catalog_products('zd-sub') where slug = 'zd-tee'),
  1::bigint,
  'a discount larger than the price leaves one poisha, never a negative price'
);

-- ---------------------------------------------------------------------------
-- 4. Overlapping campaigns resolve by one documented order, never by stacking
-- ---------------------------------------------------------------------------

-- Back to the plain 30% category campaign.
update public.discount_campaigns
   set discount_kind = 'percent', discount_value = 30, max_discount_minor = null
 where id = 'cc000000-0000-4000-8000-0000000000e1';

-- A brand campaign (15%) that also reaches the Nike tee in the subcategory.
insert into public.discount_campaigns
  (id, name, customer_title, scope, discount_kind, discount_value, status)
values ('cc000000-0000-4000-8000-0000000000e2', 'ZD Brand', 'ZD Brand Sale',
        'brands', 'percent', 15, 'active');

insert into public.discount_campaign_brands (campaign_id, brand_id)
values ('cc000000-0000-4000-8000-0000000000e2', 'b0000000-0000-4000-8000-0000000000e1');

-- A storewide campaign (5%).
insert into public.discount_campaigns
  (id, name, customer_title, scope, discount_kind, discount_value, status)
values ('cc000000-0000-4000-8000-0000000000e3', 'ZD Store', 'ZD Storewide',
        'storewide', 'percent', 5, 'active');

select is(
  (select campaign_title from public.catalog_products(null, null, 'featured', 24, 0, array['zd-dept','zd-sub']) where slug = 'zd-nike-tee'),
  'ZD Winter Sale',
  'a category campaign beats a brand campaign'
);

update public.discount_campaigns set status = 'paused'
 where id = 'cc000000-0000-4000-8000-0000000000e1';

select is(
  (select campaign_title from public.catalog_products(null, null, 'featured', 24, 0, array['zd-dept','zd-sub']) where slug = 'zd-nike-tee'),
  'ZD Brand Sale',
  'with the category campaign paused, the brand campaign takes over'
);
select is(
  (select price_minor from public.catalog_products(null, null, 'featured', 24, 0, array['zd-dept','zd-sub']) where slug = 'zd-nike-tee'),
  212500::bigint,
  '15% off the 2500.00 list price, not 30% off a price the brand campaign did not set'
);
select is(
  (select price_minor from public.catalog_products(null, null, 'featured', 24, 0, array['zd-dept','zd-sub']) where slug = 'zd-polo'),
  142500::bigint,
  'the storewide campaign prices a product no closer campaign targets'
);

-- A product-targeted campaign outranks every broader one.
insert into public.discount_campaigns
  (id, name, customer_title, scope, discount_kind, discount_value, status)
values ('cc000000-0000-4000-8000-0000000000e4', 'ZD Product', 'ZD Product Deal',
        'products', 'percent', 10, 'active');

insert into public.discount_campaign_products (campaign_id, product_id)
values ('cc000000-0000-4000-8000-0000000000e4', '0d000000-0000-4000-8000-0000000000e3');

select is(
  (select campaign_title from public.catalog_products(null, null, 'featured', 24, 0, array['zd-dept','zd-sub']) where slug = 'zd-nike-tee'),
  'ZD Product Deal',
  'a product campaign beats a brand campaign'
);

-- Two campaigns at the same scope level: the higher priority wins.
insert into public.discount_campaigns
  (id, name, customer_title, scope, discount_kind, discount_value, status, priority)
values ('cc000000-0000-4000-8000-0000000000e5', 'ZD Priority', 'ZD Priority Sale',
        'products', 'percent', 20, 'active', 5);

insert into public.discount_campaign_products (campaign_id, product_id)
values ('cc000000-0000-4000-8000-0000000000e5', '0d000000-0000-4000-8000-0000000000e3');

select is(
  (select campaign_title from public.catalog_products(null, null, 'featured', 24, 0, array['zd-dept','zd-sub']) where slug = 'zd-nike-tee'),
  'ZD Priority Sale',
  'at the same scope the higher priority wins'
);

-- Same scope and same priority: the campaign created first wins, always the same one.
update public.discount_campaigns set priority = 5
 where id = 'cc000000-0000-4000-8000-0000000000e4';
update public.discount_campaigns set created_at = now() - interval '2 days'
 where id = 'cc000000-0000-4000-8000-0000000000e4';
update public.discount_campaigns set created_at = now() - interval '1 day'
 where id = 'cc000000-0000-4000-8000-0000000000e5';

select is(
  (select campaign_title from public.catalog_products(null, null, 'featured', 24, 0, array['zd-dept','zd-sub']) where slug = 'zd-nike-tee'),
  'ZD Product Deal',
  'a tie on scope and priority is broken by age, deterministically'
);

-- Exactly one campaign prices a product: nothing stacks.
select is(
  (select count(*)::int
   from public.product_campaigns(array['0d000000-0000-4000-8000-0000000000e3']::uuid[])),
  1,
  'one campaign governs a product, never a stack of them'
);

-- ---------------------------------------------------------------------------
-- 5. Cart and storefront feed
-- ---------------------------------------------------------------------------

select is(
  (select (l ->> 'unitPriceMinor')::bigint
   from public.quote_cart('[{"productId":"0d000000-0000-4000-8000-0000000000e3","quantity":2}]'::jsonb)
     as q, jsonb_array_elements(q -> 'lines') l),
  225000::bigint,
  'the cart prices the product at the campaign''s 10% off 2500.00'
);
select is(
  (select (l ->> 'listPriceMinor')::bigint
   from public.quote_cart('[{"productId":"0d000000-0000-4000-8000-0000000000e3","quantity":2}]'::jsonb)
     as q, jsonb_array_elements(q -> 'lines') l),
  250000::bigint,
  'the cart keeps the list price for the breakdown'
);
select is(
  (select (q ->> 'campaignDiscountMinor')::bigint
   from public.quote_cart('[{"productId":"0d000000-0000-4000-8000-0000000000e3","quantity":2}]'::jsonb) q),
  50000::bigint,
  'the cart totals the campaign saving across quantities'
);

select is(
  (select product_count from public.catalog_campaigns('ca000000-0000-4000-8000-0000000000e2')
   where campaign_id = 'cc000000-0000-4000-8000-0000000000e2'),
  1::bigint,
  'the storefront feed counts a brand campaign''s published products in a category'
);
select is(
  (select count(*)::int from public.catalog_campaigns('ca000000-0000-4000-8000-0000000000e3')),
  0,
  'a category with no targeted product gets no campaign banner'
);
select is(
  (select count(*)::int from public.catalog_campaigns(null)
   where campaign_id = 'cc000000-0000-4000-8000-0000000000e1'),
  0,
  'a paused campaign is not offered to shoppers'
);

-- ---------------------------------------------------------------------------
-- 6. Coupons and campaigns
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e4", "role": "authenticated"}';

select is(
  (public.quote_cart_with_coupon(
     '[{"productId":"0d000000-0000-4000-8000-0000000000e3","quantity":1}]'::jsonb,
     'ad000000-0000-4000-8000-0000000000e1', 'NOPE') ->> 'couponProblem'),
  'this coupon code is not valid',
  'an unknown coupon is reported, not fatal'
);

reset role;

insert into public.coupons (id, code, kind, value, min_order_minor, per_customer_limit, is_active)
values ('c0000000-0000-4000-8000-0000000000e1', 'ZD10', 'fixed', 10000, 0, 5, true);

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e4", "role": "authenticated"}';

select is(
  (public.quote_cart_with_coupon(
     '[{"productId":"0d000000-0000-4000-8000-0000000000e3","quantity":1}]'::jsonb,
     'ad000000-0000-4000-8000-0000000000e1', 'ZD10') ->> 'discountMinor')::bigint,
  10000::bigint,
  'a coupon stacks with a campaign that allows it'
);

reset role;

update public.discount_campaigns set coupon_policy = 'blocked'
 where id = 'cc000000-0000-4000-8000-0000000000e4';

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e4", "role": "authenticated"}';

select is(
  (public.quote_cart_with_coupon(
     '[{"productId":"0d000000-0000-4000-8000-0000000000e3","quantity":1}]'::jsonb,
     'ad000000-0000-4000-8000-0000000000e1', 'ZD10') ->> 'couponProblem'),
  'A coupon cannot be combined with the promotion in this cart',
  'a campaign that refuses coupons rejects the code with a reason'
);
select is(
  (public.quote_cart_with_coupon(
     '[{"productId":"0d000000-0000-4000-8000-0000000000e3","quantity":1}]'::jsonb,
     'ad000000-0000-4000-8000-0000000000e1', 'ZD10') ->> 'discountMinor')::bigint,
  0::bigint,
  'and takes nothing off'
);

-- ---------------------------------------------------------------------------
-- 7. The order snapshot, and that it never changes afterwards
-- ---------------------------------------------------------------------------

with placed as (
  select public.place_cod_order(
    '11111111-1111-4111-8111-111111111111',
    'ad000000-0000-4000-8000-0000000000e1',
    '[{"productId":"0d000000-0000-4000-8000-0000000000e3","quantity":2}]'::jsonb,
    null, null, null) as result
)
select is(
  (select ((result ->> 'orderNumber') is not null) from placed),
  true,
  'an order is placed at the promotional price'
);

reset role;

select is(
  (select unit_price_minor from public.order_items oi
   join public.orders o on o.id = oi.order_id
   where oi.product_id = '0d000000-0000-4000-8000-0000000000e3'),
  225000::bigint,
  'the order line records the campaign price'
);
select is(
  (select regular_price_minor from public.order_items oi
   join public.orders o on o.id = oi.order_id
   where oi.product_id = '0d000000-0000-4000-8000-0000000000e3'),
  250000::bigint,
  'the order line records the list price the campaign discounted'
);
select is(
  (select catalog_price_minor from public.order_items oi
   join public.orders o on o.id = oi.order_id
   where oi.product_id = '0d000000-0000-4000-8000-0000000000e3'),
  200000::bigint,
  'the order line records the product''s own sale price at purchase'
);
select is(
  (select campaign_discount_minor from public.order_items oi
   join public.orders o on o.id = oi.order_id
   where oi.product_id = '0d000000-0000-4000-8000-0000000000e3'),
  25000::bigint,
  'the order line records what the campaign took off, per unit'
);
select is(
  (select o.total_minor from public.orders o
   where o.id = (select order_id from public.order_items
                 where product_id = '0d000000-0000-4000-8000-0000000000e3')),
  456000::bigint,
  'the order total is the campaign subtotal plus delivery (2 x 2250.00 + 60.00)'
);

update public.discount_campaigns set status = 'ended'
 where id = 'cc000000-0000-4000-8000-0000000000e4';

select is(
  (select unit_price_minor from public.order_items oi
   join public.orders o on o.id = oi.order_id
   where oi.product_id = '0d000000-0000-4000-8000-0000000000e3'),
  225000::bigint,
  'ending the campaign does not touch the placed order'
);
select is(
  (select campaign_title from public.order_items oi
   join public.orders o on o.id = oi.order_id
   where oi.product_id = '0d000000-0000-4000-8000-0000000000e3'),
  'ZD Product Deal',
  'the order still names the campaign that priced it'
);

-- ---------------------------------------------------------------------------
-- 8. Permissions
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e3", "role": "authenticated"}';

select throws_ok($$
  select public.admin_save_campaign(
    null, 'ZD Staff Draft', 'ZD Staff Draft', 'storewide', 'percent', 10)
$$, 'NZ403', null, 'staff cannot create a campaign without the permission');

reset role;
insert into public.user_permissions (user_id, permission, effect) values
  ('00000000-0000-4000-8000-0000000000e3', 'discounts.view', 'grant'),
  ('00000000-0000-4000-8000-0000000000e3', 'discounts.create', 'grant'),
  ('00000000-0000-4000-8000-0000000000e3', 'discounts.edit', 'grant');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e3", "role": "authenticated"}';

select is(
  ((public.admin_save_campaign(
     null, 'ZD Staff Draft', 'ZD Staff Draft', 'storewide', 'percent', 10) ->> 'status')),
  'draft',
  'staff with the create permission make a draft'
);
select throws_ok($$
  select public.admin_set_campaign_status(
    (select id from public.discount_campaigns where name = 'ZD Staff Draft'), 'active', null)
$$, 'NZ403', null, 'but cannot activate it without the activate permission');

reset role;
insert into public.user_permissions (user_id, permission, effect)
values ('00000000-0000-4000-8000-0000000000e3', 'discounts.activate', 'grant');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e3", "role": "authenticated"}';

select is(
  (public.admin_set_campaign_status(
     (select id from public.discount_campaigns where name = 'ZD Staff Draft'), 'active', null)
   ->> 'state'),
  'active',
  'once granted the activate permission, the same account can start it'
);

reset role;

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$
  select public.admin_list_campaigns()
$$, '42501', null, 'a visitor cannot list campaigns');
reset role;

-- ---------------------------------------------------------------------------
-- 9. Concurrency, duplication and history
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}';

select throws_ok($$
  select public.admin_save_campaign(
    'cc000000-0000-4000-8000-0000000000e1', 'ZD Winter Renamed', 'ZD Winter Sale',
    'categories', 'percent', 30, null, null, null, 0, true, null, 'stackable',
    array['ca000000-0000-4000-8000-0000000000e1']::uuid[], null, null, null, 99)
$$, 'NZ492', null, 'a stale version is refused instead of overwriting another edit');

reset role;

select ok(
  (select (private.campaign_view(c) ->> 'version')::int = c.version
   from public.discount_campaigns c where c.id = 'cc000000-0000-4000-8000-0000000000e1'),
  'the campaign still carries the version its editor saw'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}';

select is(
  (public.admin_duplicate_campaign('cc000000-0000-4000-8000-0000000000e1') ->> 'status'),
  'draft',
  'duplicating a campaign produces a draft'
);

reset role;

select is(
  (select count(*)::int from public.discount_campaign_categories t
   where t.campaign_id = (
     select id from public.discount_campaigns c
     where c.name like 'ZD Winter (copy%' order by created_at limit 1)),
  1,
  'the copy keeps the original targets'
);

select ok(
  (select count(*)::int from public.audit_log a
   where a.action = 'discount_campaign.duplicated'
     and a.details ->> 'source' = 'cc000000-0000-4000-8000-0000000000e1') >= 1,
  'campaign actions are audited'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}';

select is(
  (public.admin_set_campaign_status(
     'cc000000-0000-4000-8000-0000000000e2', 'archived', null) ->> 'state'),
  'archived',
  'an admin archives a campaign'
);
select throws_ok($$
  select public.admin_save_campaign(
    'cc000000-0000-4000-8000-0000000000e2', 'ZD Brand Again', 'ZD Brand Again',
    'brands', 'percent', 15, null, null, null, 0, true, null, 'stackable',
    null, array['b0000000-0000-4000-8000-0000000000e1']::uuid[], null, null, null)
$$, 'NZ491', null, 'an archived campaign cannot be edited');

select ok(
  (public.admin_campaign_history('cc000000-0000-4000-8000-0000000000e2') ->> 'total')::int >= 1,
  'the campaign history lists its actions'
);

select is(
  (public.admin_preview_campaign(
     'storewide', 'percent', 10, null, 0, null, null, null) ->> 'activeTotal')::bigint,
  (select count(*)::bigint from public.products p where p.status = 'active'),
  'the preview counts every published product a storewide campaign would reach'
);

reset role;

select * from finish();

rollback;
