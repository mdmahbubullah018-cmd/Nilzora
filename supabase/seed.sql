-- Development seed: sample catalog and placeholder delivery charges for local work.
-- Safe to run more than once (it only adds missing rows). Nothing here is real
-- store data: set real delivery charges and products before any launch.

insert into public.delivery_charges (zone, amount_minor) values
  ('inside_dhaka', 7000),
  ('outside_dhaka', 13000)
on conflict (zone) do nothing;

insert into public.categories (slug, name, description, sort_order, is_active) values
  ('home-kitchen', 'Home & Kitchen', 'Cookware, bedding and everyday home essentials.', 10, true),
  ('fashion', 'Fashion', 'Everyday clothing and footwear for men and women.', 20, true),
  ('electronics', 'Electronics & Gadgets', 'Audio, charging and small gadgets.', 30, true),
  ('beauty-care', 'Beauty & Personal Care', 'Skin care and personal care basics.', 40, true),
  ('groceries', 'Groceries', 'Pantry staples, rice, oil and tea.', 50, true),
  ('seasonal', 'Seasonal', 'Hidden category used to check that inactive categories stay private.', 90, false)
on conflict (slug) do nothing;

with sample (category, slug, sku, name, summary, description, price, compare_at, stock, max_qty, status, featured) as (
  values
    ('home-kitchen', 'stainless-steel-water-bottle', 'NZ-DEMO-001', 'Stainless Steel Water Bottle, 750 ml',
     'Double-wall insulated bottle that keeps drinks cold for 24 hours.',
     'Food-grade stainless steel with a leak-proof screw cap. Keeps water cold for up to 24 hours and tea hot for up to 12. Fits most bag side pockets.',
     65000, 79000, 40, 10, 'active', true),
    ('home-kitchen', 'non-stick-frying-pan-24cm', 'NZ-DEMO-002', 'Non-Stick Frying Pan, 24 cm',
     'Everyday pan with a durable non-stick coating and a cool-touch handle.',
     'Aluminium body for even heating, three-layer non-stick coating and a riveted cool-touch handle. Suitable for gas and electric stoves.',
     145000, null, 15, 5, 'active', false),
    ('home-kitchen', 'cotton-bedsheet-set-double', 'NZ-DEMO-003', 'Cotton Bedsheet Set, Double',
     'Soft cotton bedsheet with two matching pillow covers.',
     'Breathable 100% cotton weave in a calm geometric print. Includes one double bedsheet and two pillow covers. Machine washable.',
     220000, 260000, 8, 4, 'active', true),
    ('home-kitchen', 'ceramic-dinner-plate-set', 'NZ-DEMO-004', 'Ceramic Dinner Plate Set (6 pcs)',
     'Six glazed ceramic dinner plates, microwave safe.',
     'A set of six 10-inch glazed ceramic plates. Microwave and dishwasher safe.',
     180000, null, 0, 4, 'active', false),
    ('fashion', 'mens-cotton-panjabi', 'NZ-DEMO-005', 'Men''s Cotton Panjabi',
     'Comfortable cotton panjabi with subtle embroidery at the collar.',
     'Lightweight cotton for warm days, with fine thread embroidery at the collar and placket. Regular fit.',
     185000, 225000, 25, 5, 'active', true),
    ('fashion', 'womens-printed-kurti', 'NZ-DEMO-006', 'Women''s Printed Kurti',
     'Breathable printed kurti for everyday wear.',
     'Soft viscose-cotton blend in a floral block print. Three-quarter sleeves and side slits for easy movement.',
     120000, null, 30, 5, 'active', false),
    ('fashion', 'unisex-canvas-sneakers', 'NZ-DEMO-007', 'Unisex Canvas Sneakers',
     'Classic low-top canvas sneakers with a cushioned insole.',
     'Durable canvas upper, rubber sole and a cushioned insole for all-day comfort.',
     210000, null, 12, 3, 'active', false),
    ('electronics', 'wireless-earbuds', 'NZ-DEMO-008', 'Wireless Earbuds with Charging Case',
     'Bluetooth earbuds with touch controls and up to 20 hours with the case.',
     'Bluetooth 5.3 earbuds with touch controls, a built-in microphone for calls and a compact charging case.',
     249000, 299000, 20, 3, 'active', true),
    ('electronics', 'power-bank-10000mah', 'NZ-DEMO-009', 'Power Bank, 10,000 mAh',
     'Slim power bank with USB-C input and two outputs.',
     'Charges most phones two to three times. USB-C input and output plus one USB-A port.',
     159000, null, 18, 3, 'active', false),
    ('electronics', 'usb-c-fast-charger-25w', 'NZ-DEMO-010', 'USB-C Fast Charger, 25 W',
     'Compact wall charger for fast charging compatible phones.',
     'A 25 W USB-C power delivery charger with a two-pin plug.',
     89000, null, 50, 5, 'active', false),
    ('beauty-care', 'herbal-face-wash-100ml', 'NZ-DEMO-011', 'Herbal Face Wash, 100 ml',
     'Gentle daily face wash with neem and turmeric extracts.',
     'A mild, soap-free cleanser for daily use. Suitable for normal to oily skin.',
     32000, null, 60, 10, 'active', false),
    ('beauty-care', 'aloe-vera-moisturiser-200ml', 'NZ-DEMO-012', 'Aloe Vera Moisturiser, 200 ml',
     'Lightweight, non-greasy moisturiser for face and body.',
     'Fast-absorbing aloe vera gel cream that hydrates without a sticky feel.',
     45000, 52000, 35, 10, 'active', false),
    ('beauty-care', 'sunscreen-spf50-50ml', 'NZ-DEMO-013', 'Sunscreen SPF 50, 50 ml',
     'Broad-spectrum sunscreen with a matte finish.',
     'SPF 50 PA+++ protection with a lightweight, matte finish for everyday outdoor use.',
     69000, null, 3, 3, 'active', false),
    ('groceries', 'aromatic-chinigura-rice-1kg', 'NZ-DEMO-014', 'Aromatic Chinigura Rice, 1 kg',
     'Fragrant small-grain rice for polao and special meals.',
     'Small-grain aromatic rice, cleaned and packed in a resealable bag.',
     16000, null, 100, 10, 'active', true),
    ('groceries', 'mustard-oil-1l', 'NZ-DEMO-015', 'Mustard Oil, 1 litre',
     'Cold-pressed mustard oil with a strong, traditional flavour.',
     'Cold-pressed mustard oil in a sealed bottle. Ideal for bhorta and pickles.',
     32000, null, 45, 10, 'active', false),
    ('groceries', 'premium-tea-leaves-400g', 'NZ-DEMO-016', 'Premium Tea Leaves, 400 g',
     'Strong, bright black tea from Sylhet gardens.',
     'Black tea leaves blended for a strong, bright cup. Resealable pack.',
     28000, null, 70, 10, 'active', false),
    ('electronics', 'smart-watch-preview', 'NZ-DEMO-017', 'Smart Watch (coming soon)',
     'Draft product: never shown in the storefront.', null,
     399000, null, 10, 2, 'draft', false),
    ('electronics', 'old-model-headphones', 'NZ-DEMO-018', 'Over-Ear Headphones (discontinued)',
     'Archived product: never shown in the storefront.', null,
     199000, null, 5, 2, 'archived', false),
    ('seasonal', 'festival-lantern', 'NZ-DEMO-019', 'Festival Paper Lantern',
     'Active product in a hidden category: never shown in the storefront.', null,
     25000, null, 20, 5, 'active', false)
)
insert into public.products (
  category_id, slug, sku, name, summary, description, price_minor, compare_at_price_minor,
  stock_quantity, max_order_quantity, status, is_featured
)
select c.id, s.slug, s.sku, s.name, s.summary, s.description, s.price, s.compare_at, s.stock,
  s.max_qty, s.status::public.product_status, s.featured
from sample s
join public.categories c on c.slug = s.category
on conflict (slug) do nothing;

-- Record the starting stock of the sample products in the ledger.
insert into public.inventory_movements (product_id, change, stock_after, reason, note)
select p.id, p.stock_quantity, p.stock_quantity, 'initial_stock', 'Development seed'
from public.products p
where p.sku like 'NZ-DEMO-%'
  and p.stock_quantity > 0
  and not exists (select 1 from public.inventory_movements m where m.product_id = p.id);

-- The tags the support queue starts with. A tag is an observation an agent makes about a
-- conversation, so these are a starting vocabulary, not a rule: any of them can be renamed
-- or switched off from the admin screen.
insert into public.chat_tags (slug, label, description)
select v.slug, v.label, v.description
from (values
  ('vip', 'VIP', 'A customer the team answers first.'),
  ('refund', 'Refund', 'The conversation involves a refund.'),
  ('return', 'Return', 'The conversation involves a returned item.'),
  ('delivery-delay', 'Delivery delay', 'The customer is waiting longer than promised.'),
  ('payment-issue', 'Payment issue', 'Cash collection or a payment record needs attention.'),
  ('follow-up', 'Follow-up', 'The customer needs a reply the team has not sent yet.')
) as v (slug, label, description)
where not exists (select 1 from public.chat_tags t where lower(t.slug) = v.slug);
