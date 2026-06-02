-- Freelane: backfill diary_entries from intent_mirror.
--
-- Each existing intent_mirror row becomes one diary entry dated at
-- week_starts. body = coalesce(intentions_text, intentions->>'focus',
-- narrative, ''). Duplicate rows by (user, date) are skipped silently —
-- a manual diary already saved that day wins.
--
-- intent_mirror is NOT dropped. It stays as an archive until a follow-up
-- migration confirms no readers reach it.

insert into finance.diary_entries (user_id, entry_date, body, created_at, updated_at)
select
  user_id,
  week_starts as entry_date,
  coalesce(
    nullif(intentions_text, ''),
    nullif(intentions->>'focus', ''),
    nullif(narrative, ''),
    ''
  ) as body,
  coalesce(generated_at, created_at, now()),
  coalesce(generated_at, updated_at, now())
from finance.intent_mirror
where coalesce(intentions_text, intentions->>'focus', narrative) is not null
on conflict (user_id, entry_date) do nothing;

comment on table finance.intent_mirror is
  'Legacy weekly grain. Superseded by finance.diary_entries (daily). Kept as archive — safe to drop in a later migration once read paths are confirmed gone.';
