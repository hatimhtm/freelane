-- Freelane: plans-redesign polish pass (migration 0090).
--
-- Three changes wired together because all three plug into the plans
-- workflow's correctness contract:
--
--   1. planned_spends.satisfaction_note — dedicated column so the +14d
--      rating UI no longer overwrites the user's pre-existing plan
--      notes (general notes / implementation hints). The original 0088
--      doc comment promised "the note is stored in the existing notes
--      column", but in practice that clobbered other content. Splits
--      the concerns cleanly.
--
--   2. notifications_inbox.deliver_at — optional scheduled delivery
--      column for kinds that the dispatcher emits BEFORE they should
--      be shown to the user (the canonical example is the +14d
--      plan_satisfaction_check, where confirmPlanBought writes the
--      row at mark-as-bought time so dedup uniqueness is recorded but
--      delivery is held back until two weeks have passed). NULL means
--      "deliver immediately" — every existing row stays semantically
--      identical. Readers that surface inbox rows filter against
--      deliver_at IS NULL OR deliver_at <= now() so a pending row
--      stays out of the bell.
--
--   3. plan_strategies — defensive CHECK + activation trigger so the
--      app code can't accidentally leave active=true with no
--      activated_at, or active=false with no deactivated_at, after
--      an activate/deactivate flip. The application code in
--      activateStrategy / deactivateStrategy already writes these,
--      but the trigger backstops any future writer (e.g. a SECURITY
--      DEFINER RPC or a backfill).

-- ─── 1. satisfaction_note ──
alter table finance.planned_spends
  add column if not exists satisfaction_note text;

-- ─── 2. deliver_at on notifications_inbox ──
alter table finance.notifications_inbox
  add column if not exists deliver_at timestamptz;

-- Partial index for the unread sweep — match the dispatcher's listOpen
-- filter (read_at is null + dismissed_at is null + deliver_at gate).
create index if not exists notifications_inbox_user_due_idx
  on finance.notifications_inbox (user_id, deliver_at)
  where read_at is null and dismissed_at is null;

-- ─── 3. plan_strategies activation timestamp invariant ──
-- Touch trigger that sets activated_at on active=true / deactivated_at
-- on active=false. Idempotent — if either timestamp is already set,
-- leaves it alone (preserves the original event time when an UPDATE
-- only touches an unrelated column).
create or replace function finance.plan_strategies_touch_activation()
returns trigger
language plpgsql
as $$
begin
  if new.active = true and (old is null or old.active = false) then
    if new.activated_at is null then
      new.activated_at := now();
    end if;
    new.deactivated_at := null;
  elsif new.active = false and (old is null or old.active = true) then
    if new.deactivated_at is null then
      new.deactivated_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists plan_strategies_touch_activation on finance.plan_strategies;
create trigger plan_strategies_touch_activation
  before insert or update on finance.plan_strategies
  for each row execute function finance.plan_strategies_touch_activation();

-- Hard invariant — active rows MUST have an activated_at. Inactive rows
-- with no deactivated_at are tolerable for never-activated proposals
-- (active=false from insert), so only the active=true side is checked.
alter table finance.plan_strategies
  drop constraint if exists plan_strategies_active_requires_timestamp;
alter table finance.plan_strategies
  add constraint plan_strategies_active_requires_timestamp
    check (active = false or activated_at is not null);
