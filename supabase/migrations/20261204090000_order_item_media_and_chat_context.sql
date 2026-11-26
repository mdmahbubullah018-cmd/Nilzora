-- Order item pictures and the product a support thread is about
-- =============================================================
--
-- 1. `order_items` keeps the picture the customer saw when they ordered. The two public
--    URLs are built by the API from the configured media base (as every other picture is),
--    so moving the bucket or its domain never breaks an old order, and a product that is
--    later re-photographed or deleted never changes what the customer's own order shows.
--
-- 2. Lines written before this migration are backfilled from the product's current primary
--    picture: for an order placed before the snapshot existed, that is the best record
--    available, and it is far better than a blank tile.
--
-- 3. `place_cod_order` records the snapshot in the same transaction as the line.
--
-- 4. `chat_conversation` reports the picture and the chosen variant of the product a support
--    thread is about, plus a short item list for an order thread, so the customer and the
--    agent see immediately what is being discussed. The order items behind it are already
--    readable only through the same ownership rules: the conversation is resolved by
--    `private.chat_require_read` before any of it is built.

alter table public.order_items
  add column image_key text
    check (image_key is null or char_length(image_key) between 1 and 200),
  add column image_alt text
    check (image_alt is null or char_length(image_alt) between 1 and 160);

update public.order_items oi
set (image_key, image_alt) = (
  select pi.storage_key, pi.alt_text
  from public.product_images pi
  where pi.product_id = oi.product_id
  order by pi.position, pi.id
  limit 1
)
where oi.image_key is null;

comment on column public.order_items.image_key is
  'Base media key of the picture shown when the line was ordered; the API builds its URLs.';
comment on column public.order_items.image_alt is
  'The picture''s alt text at purchase time.';

-- ---------------------------------------------------------------------------
-- Placing an order keeps the picture
-- ---------------------------------------------------------------------------

create or replace function public.place_cod_order(
  p_idempotency_key uuid,
  p_address_id uuid,
  p_items jsonb,
  p_note text default null,
  p_expected_total_minor bigint default null,
  p_coupon_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_fingerprint text;
  v_existing public.orders;
  v_address public.addresses;
  v_zone public.delivery_zone;
  v_fee bigint;
  v_subtotal bigint;
  v_item_count integer;
  v_problems jsonb;
  v_coupon public.coupons;
  v_discount bigint := 0;
  v_order public.orders;
begin
  if v_user is null then
    raise exception 'sign in to place an order' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_address_id is null then
    raise exception 'an idempotency key and an address are required' using errcode = 'NZ412';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'the note is too long' using errcode = 'NZ412';
  end if;

  if not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'this account cannot place orders' using errcode = 'NZ410';
  end if;

  perform 1 from private.cart_items(p_items);

  v_fingerprint := md5(jsonb_build_object(
    'address', p_address_id,
    'note', v_note,
    'coupon', upper(btrim(coalesce(p_coupon_code, ''))),
    'items', (
      select jsonb_agg(jsonb_build_array(ci.product_id, ci.variant_id, ci.quantity) order by ci.product_id, ci.variant_id)
      from private.cart_items(p_items) as ci
    )
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_idempotency_key::text, 0));

  select * into v_existing
  from public.orders
  where user_id = v_user and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'this idempotency key was already used for a different order'
        using errcode = 'NZ416';
    end if;
    return jsonb_build_object(
      'orderId', v_existing.id, 'orderNumber', v_existing.order_number, 'created', false
    );
  end if;

  if (select count(*) from public.orders where user_id = v_user and status = 'pending') >= 5 then
    raise exception 'too many orders are waiting for confirmation' using errcode = 'NZ420';
  end if;

  select * into v_address from public.addresses where id = p_address_id and user_id = v_user;
  if not found then
    raise exception 'address not found' using errcode = 'NZ411';
  end if;

  select d.delivery_zone into v_zone
  from public.bd_districts d
  where d.name = v_address.district and d.division = v_address.division;

  select amount_minor into v_fee from public.delivery_charges where zone = v_zone;
  if v_fee is null then
    raise exception 'delivery is not available for this address yet' using errcode = 'NZ417';
  end if;

  perform 1
  from public.products
  where id in (select ci.product_id from private.cart_items(p_items) as ci)
  order by id
  for update;

  perform 1
  from public.product_variants
  where id in (select ci.variant_id from private.cart_items(p_items) as ci where ci.variant_id is not null)
  order by id
  for update;

  select
    coalesce(sum(l.line_total_minor), 0),
    coalesce(sum(l.quantity), 0),
    jsonb_agg(jsonb_build_object('productId', l.product_id, 'variantId', l.variant_id, 'problem', l.problem)
      order by l.line_no) filter (where l.problem is not null)
  into v_subtotal, v_item_count, v_problems
  from private.price_cart(p_items) as l;

  if v_problems is not null then
    if exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'unavailable') then
      raise exception 'some products are not available' using errcode = 'NZ413', detail = v_problems::text;
    elsif exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'variant_required') then
      raise exception 'choose an option for every product that has them' using errcode = 'NZ471', detail = v_problems::text;
    elsif exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'variant_invalid') then
      raise exception 'one of the chosen options is no longer sold' using errcode = 'NZ470', detail = v_problems::text;
    elsif exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'quantity_limit') then
      raise exception 'some quantities exceed the per-order limit' using errcode = 'NZ415', detail = v_problems::text;
    else
      raise exception 'not enough stock' using errcode = 'NZ414', detail = v_problems::text;
    end if;
  end if;

  if p_coupon_code is not null and btrim(p_coupon_code) <> '' then
    -- A campaign that does not allow coupons refuses the code before it is claimed,
    -- so a blocked code is never counted as a redemption.
    if exists (
      select 1
      from private.price_cart(p_items) l
      where l.campaign_id is not null and l.campaign_coupon_policy = 'blocked'
    ) then
      raise exception 'a coupon cannot be combined with the promotion in this cart'
        using errcode = 'NZ459';
    end if;
    v_coupon := private.claim_coupon_for_cart(p_coupon_code, v_user, p_items, v_subtotal);
    v_discount := private.coupon_cart_discount(v_coupon, p_items, v_subtotal);
  end if;

  if p_expected_total_minor is not null
     and p_expected_total_minor <> v_subtotal + v_fee - v_discount then
    raise exception 'the order total has changed' using errcode = 'NZ418',
      detail = jsonb_build_object('totalMinor', v_subtotal + v_fee - v_discount)::text;
  end if;

  insert into public.orders (
    user_id, item_count, subtotal_minor, shipping_fee_minor, discount_minor, total_minor,
    delivery_zone, ship_recipient_name, ship_phone, ship_division, ship_district, ship_area,
    ship_address_line, ship_postal_code, ship_landmark, customer_note,
    idempotency_key, request_fingerprint
  ) values (
    v_user, v_item_count, v_subtotal, v_fee, v_discount, v_subtotal + v_fee - v_discount,
    v_zone, v_address.recipient_name, v_address.phone, v_address.division, v_address.district,
    v_address.area, v_address.address_line, v_address.postal_code, v_address.landmark, v_note,
    p_idempotency_key, v_fingerprint
  )
  returning * into v_order;

  insert into public.order_items (
    order_id, product_id, variant_id, variant_label, product_name, product_slug, sku,
    unit_price_minor, quantity, line_total_minor,
    regular_price_minor, catalog_price_minor, campaign_id, campaign_title, campaign_discount_minor,
    image_key, image_alt
  )
  select v_order.id, l.product_id, l.variant_id, l.variant_label, l.name, l.slug, l.sku,
         l.unit_price_minor, l.quantity, l.line_total_minor,
         l.list_price_minor, l.catalog_price_minor, l.campaign_id, l.campaign_title,
         l.campaign_discount_minor,
         img.storage_key, img.alt_text
  from private.price_cart(p_items) as l
  left join lateral (
    select pi.storage_key, pi.alt_text
    from public.product_images pi
    where pi.product_id = l.product_id
    order by pi.position, pi.id
    limit 1
  ) img on true;

  if v_coupon.id is not null then
    insert into public.coupon_redemptions (coupon_id, user_id, order_id, discount_minor)
    values (v_coupon.id, v_user, v_order.id, v_discount);
  end if;

  with moved as (
    update public.product_variants v
    set stock_quantity = v.stock_quantity - ci.quantity
    from private.cart_items(p_items) as ci
    where ci.variant_id is not null and v.id = ci.variant_id
    returning v.id, v.product_id, ci.quantity, v.stock_quantity
  )
  insert into public.inventory_movements
    (product_id, variant_id, change, stock_after, reason, order_id, actor_id)
  select moved.product_id, moved.id, -moved.quantity, moved.stock_quantity,
         'order_placed', v_order.id, v_user
  from moved;

  with moved as (
    update public.products p
    set stock_quantity = p.stock_quantity - ci.quantity
    from private.cart_items(p_items) as ci
    where ci.variant_id is null and p.id = ci.product_id
    returning p.id, ci.quantity, p.stock_quantity
  )
  insert into public.inventory_movements (product_id, change, stock_after, reason, order_id, actor_id)
  select moved.id, -moved.quantity, moved.stock_quantity, 'order_placed', v_order.id, v_user
  from moved;

  insert into public.order_status_history (order_id, from_status, to_status, actor_kind, actor_id)
  values (v_order.id, null, 'pending', 'customer', v_user);

  return jsonb_build_object('orderId', v_order.id, 'orderNumber', v_order.order_number, 'created', true);
end;
$$;

revoke execute on function public.place_cod_order(uuid, uuid, jsonb, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.place_cod_order(uuid, uuid, jsonb, text, bigint, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- The conversation payload names the product, its picture and its variant
-- ---------------------------------------------------------------------------

/**
 * The same contract as before, with the product context the support panel needs: the
 * picture the line was bought with (or the product's current primary picture for a
 * question asked before buying), the chosen variant, and a short item list for an order
 * thread. Reading a conversation still goes through `private.chat_require_read`, so a
 * customer only ever sees the order and product of a thread they may open.
 */
create or replace function public.chat_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
  v_me public.chat_conversation_participants;
  v_result jsonb;
begin
  select * into v_me
  from public.chat_conversation_participants m
  where m.conversation_id = p_conversation_id and m.user_id = v_user;

  select jsonb_build_object(
    'conversation', jsonb_build_object(
      'id', c.id,
      'kind', c.kind,
      'status', c.status,
      'priority', c.priority,
      'subject', c.subject,
      'customerId', c.customer_id,
      'orderId', c.order_id,
      'productId', c.product_id,
      'assigneeId', c.assignee_id,
      'department', c.department,
      'lastMessageAt', c.last_message_at,
      'lastMessagePreview', c.last_message_preview,
      'lastMessageSenderId', c.last_message_sender_id,
      'messageCount', c.message_count,
      'createdAt', c.created_at,
      'updatedAt', c.updated_at,
      'resolvedAt', c.resolved_at,
      'closedAt', c.closed_at,
      'firstResponseAt', c.first_response_at,
      'lastCustomerMessageAt', c.last_customer_message_at,
      'lastStaffMessageAt', c.last_staff_message_at,
      'csatRating', c.csat_rating,
      'escalatedAt', c.escalated_at,
      'automationPaused', c.automation_paused,
      'tags', private.chat_tag_list(c.id),
      'pinnedCount', (
        select count(*) from public.chat_messages m
        where m.conversation_id = c.id and m.pinned_at is not null and m.deleted_at is null
      ),
      'attachmentCount', (
        select count(*) from public.chat_attachments a
        where a.conversation_id = c.id and a.status = 'attached'
      )
    ),
    'viewer', jsonb_build_object(
      'userId', v_user,
      'role', case
        when v_me.user_id is not null then v_me.role
        else private.chat_sender_role(v_user)
      end,
      'lastReadSeq', coalesce(v_me.last_read_seq, 0),
      'isAssignee', coalesce(c.assignee_id = v_user, false),
      'canReply', private.chat_can_reply(v_user, p_conversation_id),
      'canAssign', private.chat_can_support(v_user),
      'canUseInternalNotes', private.chat_can_support(v_user),
      'canTag', private.chat_can_support(v_user) or private.chat_holds(v_user, 'chat.reports.review'),
      'canReviewReports', private.chat_holds(v_user, 'chat.reports.review'),
      'canManageAutomation', private.chat_holds(v_user, 'chat.automation.manage')
    ),
    'customer', case when c.customer_id is null then null else jsonb_build_object(
      'id', cu.id,
      'name', cu.full_name,
      'phone', cu.phone,
      'email', cu.email
    ) end,
    'order', case when c.order_id is null then null else jsonb_build_object(
      'id', o.id,
      'number', o.order_number,
      'status', o.status,
      'paymentStatus', o.payment_status,
      'totalMinor', o.total_minor,
      'itemCount', o.item_count,
      'placedAt', o.placed_at,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'productId', x.product_id,
          'name', x.product_name,
          'variantLabel', x.variant_label,
          'quantity', x.quantity,
          'imageKey', x.image_key,
          'imageAlt', x.image_alt
        ) order by x.id)
        from (
          select oi.id, oi.product_id, oi.product_name, oi.variant_label, oi.quantity,
                 oi.image_key, oi.image_alt
          from public.order_items oi
          where oi.order_id = c.order_id
          order by oi.id
          limit 4
        ) x
      ), '[]'::jsonb)
    ) end,
    'product', case when c.product_id is null then null else jsonb_build_object(
      'id', pr.id,
      'slug', pr.slug,
      'name', pr.name,
      'priceMinor', coalesce(oi.unit_price_minor, pr.price_minor),
      'status', pr.status,
      'imageKey', coalesce(oi.image_key, pi.storage_key),
      'imageAlt', coalesce(oi.image_alt, pi.alt_text),
      'variantLabel', oi.variant_label
    ) end,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', m.user_id,
        'role', m.role,
        'name', p.full_name,
        'email', p.email,
        'lastReadSeq', m.last_read_seq,
        'lastDeliveredSeq', m.last_delivered_seq,
        'joinedAt', m.joined_at
      ) order by m.joined_at, m.user_id)
      from public.chat_conversation_participants m
      join public.profiles p on p.id = m.user_id
      where m.conversation_id = c.id and m.left_at is null
    ), '[]'::jsonb)
  )
  into v_result
  from public.chat_conversations c
  left join public.profiles cu on cu.id = c.customer_id
  left join public.orders o on o.id = c.order_id
  left join public.products pr on pr.id = c.product_id
  -- The line this thread is about, when the conversation was opened from an order: it
  -- carries the variant, the picture and the price the customer actually paid.
  left join lateral (
    select oi.variant_label, oi.image_key, oi.image_alt, oi.unit_price_minor
    from public.order_items oi
    where oi.order_id = c.order_id and oi.product_id = c.product_id
    order by oi.id
    limit 1
  ) oi on true
  -- A product question asked before buying has no order line: the product's own primary
  -- picture stands in.
  left join lateral (
    select pimg.storage_key, pimg.alt_text
    from public.product_images pimg
    where pimg.product_id = c.product_id
    order by pimg.position, pimg.id
    limit 1
  ) pi on true
  where c.id = p_conversation_id;

  return v_result;
end;
$$;

revoke execute on function public.chat_conversation(uuid) from public, anon;
grant execute on function public.chat_conversation(uuid) to authenticated, service_role;
