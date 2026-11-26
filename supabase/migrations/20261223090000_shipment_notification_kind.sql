-- ---------------------------------------------------------------------------
-- Courier integration (1 of 2): the customer notification kind for shipments
--
-- A courier shipment moving (booked, picked up, out for delivery, delivered, failed,
-- returned) is told to the customer as its own kind, `shipment_update`, so the inbox can
-- show it with its own icon and words. Whether it is sent follows the customer's existing
-- "order updates" preference (see private.notify_customer in the next migration): no new
-- preference, no new switch.
--
-- On its own file because a new enum value cannot be used inside the transaction that adds
-- it; the next migration (20261223091000_courier_foundation.sql) uses it.
--
-- Rollback: an enum value cannot be dropped in place. To undo, recreate
-- customer_notification_kind without 'shipment_update' after deleting the rows that use it
-- (none exist until a shipment has been booked).
-- ---------------------------------------------------------------------------

alter type public.customer_notification_kind add value if not exists 'shipment_update';
