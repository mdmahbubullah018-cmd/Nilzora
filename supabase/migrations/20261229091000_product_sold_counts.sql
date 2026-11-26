-- Units sold per product, for the "N sold" label on product cards and product pages.
--
-- Read on demand for just the products on the page being shown (at most a few dozen ids), using the
-- existing order_items(product_id) index: there is no new table, trigger or stored counter to keep
-- in step with the order workflow, so the figure can never drift from the orders themselves.
--
-- What counts: units on DELIVERED orders only. A pending, confirmed, processing or shipped order
-- may still be cancelled, and a cancelled order never counts. Units a customer has returned (an
-- approved, received or completed return) are taken back off, so the figure is units that stayed
-- sold. Cart additions and order attempts are never involved.
--
-- Security definer because orders are private to their owners; the function returns only a
-- product id and a unit count, never an order, a customer or an amount.

create function public.catalog_sold_counts(p_product_ids uuid[])
returns table (product_id uuid, sold bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with lines as (
    select oi.product_id,
           oi.quantity - coalesce((
             select sum(ri.quantity)
               from public.return_items ri
               join public.return_requests rr on rr.id = ri.return_request_id
              where ri.order_item_id = oi.id
                and rr.status in ('approved', 'received', 'completed')
           ), 0) as kept
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where oi.product_id = any (p_product_ids)
       and o.status = 'delivered'
       -- Same visibility as the public catalogue: no figure for a draft or archived product.
       and exists (
         select 1 from public.products p where p.id = oi.product_id and p.status = 'active'
       )
  )
  select l.product_id, greatest(0, sum(l.kept))::bigint as sold
    from lines l
   where cardinality(p_product_ids) <= 200
   group by l.product_id;
$$;

comment on function public.catalog_sold_counts(uuid[]) is
  'Units sold per product on delivered orders, less approved returns. For cards and product pages.';

revoke execute on function public.catalog_sold_counts(uuid[]) from public;
grant execute on function public.catalog_sold_counts(uuid[]) to anon, authenticated, service_role;
