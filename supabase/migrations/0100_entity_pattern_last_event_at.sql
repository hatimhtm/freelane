-- Freelane: per-entity baseline gets a true "last event time" column
-- (Entities workflow — pattern detection cadence correctness fix).
--
-- Verifier finding: cadenceDays for the EWMA update was being computed
-- against entity_pattern_baselines.updated_at, which is the wall-clock
-- baseline-write time (set by the touch trigger to now() on every
-- UPSERT). That conflates "when did I write the row" with "when did the
-- prior event happen". If the user back-dates a spend, or two events
-- arrive in the same wall-clock second covering weeks of spent_at, the
-- cadence sample fed into EWMA is wrong (often negative or zero, which
-- then trips the `now > prior` gate and silently drops the cadence
-- update).
--
-- last_event_at carries the event's own spent_at / paid_at / event_at
-- timestamp (whatever the source carries — the driver passes it through
-- explicitly). updateBaseline() persists this column from the incoming
-- event's eventAt; readers compute cadenceDays from
-- (newEventAt - last_event_at). The touch trigger continues to maintain
-- updated_at for ordinary row-mutation accounting.

alter table finance.entity_pattern_baselines
  add column if not exists last_event_at timestamptz;

comment on column finance.entity_pattern_baselines.last_event_at is
  'Timestamp of the most recent event folded into this baseline (spent_at / paid_at / event_at — NOT the row write time). Used by updateBaseline() to compute cadenceDays as (newEventAt - last_event_at) so back-dated and same-wall-second events get the right cadence sample.';
