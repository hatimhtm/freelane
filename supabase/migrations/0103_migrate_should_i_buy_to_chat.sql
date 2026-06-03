-- Freelane: backfill historical finance.should_i_buy_sessions rows into
-- finance.chat_messages + finance.chat_session_summaries so the page-aware
-- chatbot's history reader can surface the user's existing decision archive
-- after the /should-i-buy route is collapsed.
--
-- Why both tables: listChatHistory (src/lib/ai/chat-actions.ts) filters
-- chat_messages by a single active session_id, and an "active" session is
-- defined as one whose newest message is within the 30m idle window.
-- Historical decision rows are days / months / years old — they will never
-- qualify as active. The digest list on the modal IS the surface that
-- reads cross-session: it pulls chat_session_summaries by (user_id,
-- page_key) ordered by ended_at desc. So we backfill ONE chat_messages
-- pair PLUS ONE chat_session_summaries row per historical decision — the
-- digest list will then surface "asked about <item> · <verdict>" lines
-- on the page-aware chatbot history, and clicking a digest can later
-- restore the matching chat_messages pair if a session-restore reader
-- is wired (out of scope here).
--
-- Page-key choice: the original /should-i-buy route was deleted, so
-- 'should_i_buy' is a synthetic key no real page emits. The chatbot is
-- now per-page, and the Today surface is where these decisions most
-- naturally re-surface (Today is the LifeOS hub and the user almost
-- always opens the chatbot there). Backfill rows land under page_key
-- 'today' so the existing digest reader finds them; new decisions
-- routed through the chatbot's intent-classifier ALSO land under the
-- page the user is actually on (see chat-actions.ts), so past + future
-- live under real page_keys instead of a dead synthetic one.
--
-- Idempotency: the user / assistant insert guards key on
-- (user_id, session_id, page_context->>'migrated_from') so re-runs
-- NO-OP. session_id is just the original should_i_buy_sessions.id —
-- it's already 128 bits of uniqueness; deriving anything from it would
-- add no information.
--
-- The chat_messages table has an index on (user_id, session_id, created_at)
-- (see 0064_chat_messages.sql), so adding the session_id eq to the
-- NOT EXISTS guard kicks the leading-prefix usage in instead of
-- seq-scanning chat_messages on a JSON path expression that has no
-- supporting index.
--
-- archived_at on the backfilled rows: 0064_chat_messages.sql defines
-- archived_at NOT NULL to mean "this row has already been compressed
-- into chat_session_summaries". That is EXACTLY the state of every
-- row we insert here — we also insert the matching summary at the
-- bottom of this migration. We therefore stamp archived_at on the
-- inserts so:
--   1. sweepStaleSessions (chat-actions.ts) skips them on next app
--      load — without this, every historical session would be picked
--      up as "stale" and fire an N×Flash-Lite re-summarization that
--      OVERWRITES the hand-crafted "asked about <item> · <verdict>"
--      digest below (session-summarizer upserts on session_id
--      WITHOUT ignoreDuplicates).
--   2. findActiveSession (chat-actions.ts) won't pick a recently
--      decided backfilled row as the live Today session — these are
--      historical archives, not resumable threads.

-- ─── User messages backfill ────────────────────────────────────────────
insert into finance.chat_messages (
  user_id,
  session_id,
  page_key,
  role,
  content,
  page_context,
  created_at,
  archived_at
)
select
  s.user_id,
  s.id,
  'today',
  'user',
  s.item,
  jsonb_build_object(
    'migrated_from',  'should_i_buy_sessions',
    'session_id',     s.id::text,
    'amount',         s.amount,
    'currency',       s.currency,
    'amount_base',    s.amount_base,
    'note',           s.note,
    'asked_at',       s.created_at
  ),
  s.created_at,
  -- See header comment: stamping archived_at marks this row as already
  -- digested so sweepStaleSessions / findActiveSession skip it.
  coalesce(s.decided_at, s.created_at + interval '1 second')
from finance.should_i_buy_sessions s
where not exists (
  select 1
    from finance.chat_messages m
   where m.user_id = s.user_id
     and m.session_id = s.id
     and m.role = 'user'
     and m.page_context ->> 'migrated_from' = 'should_i_buy_sessions'
);

-- ─── Assistant messages backfill ───────────────────────────────────────
-- created_at uses coalesce(s.decided_at, s.created_at + 1s) — the gap
-- between asking and deciding is editorially meaningful (the year-letter
-- brain narrates "asked in March, didn't buy, asked again in September
-- and did"). When decided_at is null we fall back to a +1s nudge so the
-- assistant row still orders AFTER the user row in the same thread. The
-- +1s nudge is purely for monotonic ordering of the user→assistant pair
-- inside one session and is not load-bearing anywhere else.
insert into finance.chat_messages (
  user_id,
  session_id,
  page_key,
  role,
  content,
  page_context,
  created_at,
  archived_at
)
select
  s.user_id,
  s.id,
  'today',
  'assistant',
  coalesce(s.narrative, '(no verdict captured)'),
  jsonb_build_object(
    'migrated_from',   'should_i_buy_sessions',
    'session_id',      s.id::text,
    'verdict',         s.verdict,
    'confidence',      s.confidence,
    'bought',          s.bought,
    'decided_at',      s.decided_at,
    'amount_base',     s.amount_base,
    'currency',        s.currency,
    'input_snapshot',  s.input_snapshot,
    -- Tag with routed_intent so session-summarizer's existing
    -- should_i_buy detector (page_context.routed_intent='should_i_buy')
    -- treats backfilled rows identically to live routed rows.
    'routed_intent',   'should_i_buy',
    'decision_result', jsonb_build_object(
      'item',    s.item,
      'verdict', s.verdict
    )
  ),
  coalesce(s.decided_at, s.created_at + interval '1 second'),
  -- Same archived_at stamp as the user row — these are historical
  -- archives, never resumable threads. See header comment.
  coalesce(s.decided_at, s.created_at + interval '1 second')
from finance.should_i_buy_sessions s
where not exists (
  select 1
    from finance.chat_messages m
   where m.user_id = s.user_id
     and m.session_id = s.id
     and m.role = 'assistant'
     and m.page_context ->> 'migrated_from' = 'should_i_buy_sessions'
);

-- ─── Session digests backfill ──────────────────────────────────────────
-- One chat_session_summaries row per historical decision so the digest
-- list on the per-page chatbot modal actually surfaces "asked about
-- <item> · <verdict>" lines. Without this the backfilled chat_messages
-- rows would be unreachable through any UI — listChatHistory keys off
-- the active session and the digest list is the only cross-session
-- reader.
--
-- summary = canonical decision line (≤ 400 char budget per session-
-- summarizer's contract). Includes the verdict label so the digest
-- snapshot is self-describing without re-fetching the chat_messages.
--
-- Idempotency: chat_session_summaries.session_id has a unique constraint
-- (per 0065_chat_session_summaries.sql), so we add ON CONFLICT DO
-- NOTHING. session_id mirrors the chat_messages.session_id we wrote
-- above (== s.id) so the digest and message pair share one identity.
insert into finance.chat_session_summaries (
  user_id,
  session_id,
  page_key,
  summary,
  message_count,
  started_at,
  ended_at
)
select
  s.user_id,
  s.id,
  'today',
  'asked about ' || s.item || ' · ' || coalesce(s.verdict, '(no verdict)'),
  -- Invariant: exactly 2 rows per backfilled session (one user + one
  -- assistant insert above). If a future migration ever adds a system
  -- row or splits the assistant turn, update this literal.
  2,
  s.created_at,
  coalesce(s.decided_at, s.created_at + interval '1 second')
from finance.should_i_buy_sessions s
on conflict (session_id) do nothing;
