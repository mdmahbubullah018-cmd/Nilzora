-- More of what an automatic answer may honestly say
-- --------------------------------------------------
-- The assistant answers only from facts it was handed. Several answers were wrong or empty
-- because the fact was never handed over, not because it did not exist:
--
--   deliveryCharges  `public.delivery_charges` holds one amount per zone (inside_dhaka and
--                    outside_dhaka). An earlier header here said the store keeps no fee anywhere;
--                    that was wrong. Each amount is null when the store has not set that zone.
--   defaultZone      The delivery zone of the conversation's own customer's default saved address
--                    (from `bd_districts.delivery_zone`), or null when there is none.
--   order            The order a message names, or else the order the thread was opened about,
--                    now with its payment status, delivery time, whether a return can still be
--                    asked for (the same rule as `request_return`: delivered, and inside the
--                    return window counted from `private.delivered_at`) and, for a real shipment,
--                    its courier name, status and tracking code. When a number IS named, only
--                    that customer's own order with that number is returned - never the linked
--                    order, so a number that is not theirs can not be answered with another
--                    order's status.
--   recentOrders     The customer's three newest orders, same shape, so "where is my order?" with
--                    no number can be answered about the customer's own latest order.
--   product          Adds the active options (variants) with their own stock, so "do you have it
--                    in size M?" is answered from the option, never from the product total. The
--                    name of a product that is not active is not handed over at all.
--
-- Shipments: test shipments (`is_mock`) and ones the courier has not accepted are never
-- reported; costs, settlement and raw courier data are never read.
--
-- Everything stays scoped by `c.customer_id = p_customer_id`; the grant is unchanged (service
-- role only). Local only until the owner applies it to the hosted project.
--
-- Rollback: re-create the previous definition from 20261222090000_chat_assistant_grounded_facts.sql
-- and drop private.chat_assistant_order_fact(uuid).

create or replace function private.chat_assistant_order_fact(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'orderNumber', o.order_number,
    'status', o.status,
    'paymentStatus', o.payment_status,
    'placedAt', o.placed_at,
    'deliveredAt', private.delivered_at(o.id),
    -- The same rule request_return enforces: delivered, and delivered inside the window.
    'returnEligible', (
      o.status = 'delivered'
      and coalesce(
        private.delivered_at(o.id) >= now() - make_interval(days => private.return_window_days()),
        false
      )
    ),
    -- The newest real forward shipment the courier has accepted; never costs or test data.
    'shipment', (
      select jsonb_build_object(
        'status', s.status,
        'providerName', a.display_name,
        'trackingCode', s.tracking_code
      )
      from public.shipments s
      join public.courier_accounts a on a.provider = s.provider
      where s.order_id = o.id
        and s.kind = 'forward'
        and not s.is_mock
        and s.status not in ('draft', 'quoted', 'booking_pending', 'booking_failed', 'cancelled')
      order by s.created_at desc
      limit 1
    )
  )
  from public.orders o
  where o.id = p_order_id;
$$;

revoke all on function private.chat_assistant_order_fact(uuid) from public, anon, authenticated;

create or replace function public.chat_assistant_facts(
  p_conversation_id uuid,
  p_customer_id uuid,
  p_order_number text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', c.kind,
    'status', c.status,
    'assigneeId', c.assignee_id,
    'automationPaused', c.automation_paused,
    'storeName', coalesce(nullif(btrim(p.display_name), ''), 'Nilzora'),
    'businessHours', p.business_hours,
    'supportEmail', p.support_email,
    'supportPhone', p.support_phone,
    'customerMessages', (
      select count(*) from public.chat_messages m
      where m.conversation_id = c.id and m.sender_role = 'customer' and m.deleted_at is null
    ),
    'humanReplies', (
      select count(*) from public.chat_messages m
      where m.conversation_id = c.id
        and m.sender_role in ('staff', 'moderator')
        and m.deleted_at is null
    ),
    -- True once an automatic answer has already gone out for the newest customer message.
    'answered', exists (
      select 1 from public.chat_messages m
      where m.conversation_id = c.id
        and m.sender_role = 'system'
        and m.kind = 'automated'
        and m.deleted_at is null
        and m.created_at >= coalesce(c.last_customer_message_at, c.created_at)
    ),
    -- Only an order of the conversation's own customer can ever appear. A number the message
    -- names is looked up on its own and never falls back to the linked order.
    'order', case
      when nullif(btrim(coalesce(p_order_number, '')), '') is not null then (
        select private.chat_assistant_order_fact(o.id)
        from public.orders o
        where o.user_id = c.customer_id
          and upper(o.order_number) = upper(btrim(p_order_number))
        limit 1
      )
      else (
        select private.chat_assistant_order_fact(o.id)
        from public.orders o
        where o.id = c.order_id and o.user_id = c.customer_id
      )
    end,
    'recentOrders', coalesce((
      select jsonb_agg(private.chat_assistant_order_fact(r.id) order by r.placed_at desc, r.id desc)
      from (
        select o.id, o.placed_at
        from public.orders o
        where o.user_id = c.customer_id
        order by o.placed_at desc, o.id desc
        limit 3
      ) r
    ), '[]'::jsonb),
    'returnWindowDays', s.return_window_days,
    'codEnabled', s.cod_enabled,
    -- What delivery costs per zone, in poisha; null when that zone has no charge set.
    'deliveryCharges', jsonb_build_object(
      'insideDhaka', (select dc.amount_minor from public.delivery_charges dc where dc.zone = 'inside_dhaka'),
      'outsideDhaka', (select dc.amount_minor from public.delivery_charges dc where dc.zone = 'outside_dhaka')
    ),
    -- The zone of this customer's default saved address, if they have one.
    'defaultZone', (
      select d.delivery_zone
      from public.addresses a
      join public.bd_districts d on d.name = a.district and d.division = a.division
      where a.user_id = c.customer_id and a.is_default
      limit 1
    ),
    'product', (
      select jsonb_build_object(
        'name', case when pr.status = 'active' then pr.name end,
        'slug', pr.slug,
        'status', pr.status,
        'stock', pr.stock_quantity,
        'variants', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'options', coalesce((
                select jsonb_agg(av.value order by pa.position, pa.id)
                from public.product_variant_values pvv
                join public.product_attribute_values av on av.id = pvv.attribute_value_id
                join public.product_attributes pa on pa.id = pvv.attribute_id
                where pvv.variant_id = pv.id
              ), '[]'::jsonb),
              'stock', pv.stock_quantity
            )
            order by pv.position, pv.id
          )
          from (
            select v.id, v.position, v.stock_quantity
            from public.product_variants v
            where v.product_id = pr.id and v.is_active
            order by v.position, v.id
            limit 100
          ) pv
        ), '[]'::jsonb)
      )
      from public.products pr
      where pr.id = c.product_id
    )
  )
  from public.chat_conversations c
  left join public.store_profile p on p.id
  left join public.store_settings s on s.id
  where c.id = p_conversation_id
    and c.customer_id is not distinct from p_customer_id;
$$;

comment on function public.chat_assistant_facts(uuid, uuid, text) is
  'Everything the automatic support answer may say, for one conversation of one customer: store profile and settings, delivery charges, the customer''s own orders (with customer-safe shipment tracking) and the thread''s product with its options. A null fact means "not published", which the assistant turns into a handoff.';

revoke all on function public.chat_assistant_facts(uuid, uuid, text) from public;
grant execute on function public.chat_assistant_facts(uuid, uuid, text) to service_role;
