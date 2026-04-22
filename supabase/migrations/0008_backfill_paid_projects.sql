-- Freelane: backfill synthetic payment rows for any project whose status is
-- 'paid' but whose payments table entries don't cover the project amount.
-- Without this row, the dashboard (which sums payments) shows the project in
-- "Pending" instead of "Earned". One-time heal; future status→paid flips
-- will create the payment automatically via the server action.

insert into finance.payments (user_id, project_id, amount, currency, paid_at, method)
select
  p.user_id,
  p.id,
  p.amount - coalesce(paid.total, 0)                                as amount,
  p.currency,
  coalesce(p.completed_at, p.updated_at::date, current_date)        as paid_at,
  'Backfill (status = paid)'                                        as method
from finance.projects p
left join lateral (
  select sum(pay.amount)::numeric as total
  from finance.payments pay
  where pay.project_id = p.id
    and pay.currency   = p.currency
) paid on true
where p.status = 'paid'
  and p.amount > coalesce(paid.total, 0);
