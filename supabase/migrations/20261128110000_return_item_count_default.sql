-- request_return (20261104090000) inserts the return request first and sets item_count from
-- its lines afterwards (in the same transaction), but the column is NOT NULL with no default,
-- so every request failed (23502) and no customer could ever ask for a return. A placeholder
-- default lets that first insert succeed; the same function overwrites it with the real count
-- before it commits, and the CHECK (item_count > 0) still holds for every stored row.

alter table public.return_requests alter column item_count set default 1;
