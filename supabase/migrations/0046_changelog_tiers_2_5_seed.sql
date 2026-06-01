-- Backfill the "What's new" feed with the Tier 2-5 + Polish-1 entries that
-- shipped between 2026-06-01 and 2026-06-01. Idempotent: each insert is
-- skipped when a row with the same (author_id, version) already exists.
-- The owner's email is hard-coded — single-user app.

do $$
declare
  owner_id uuid;
begin
  select id into owner_id from auth.users where email = 'maxdedurfort@gmail.com' limit 1;
  if owner_id is null then
    raise notice 'Owner not found — skipping changelog seed.';
    return;
  end if;

  insert into finance.app_changelog (author_id, version, released_at, kind, title, body, highlights, tier, is_pinned)
  select owner_id, '2026.06.T2', '2026-06-01', 'release',
         'Tier 2 — Cultural & seasonal',
         $body$Vendors, entities and the seasonal rhythm — Ramadan, Eid, school calendar, fiesta — flow into Today. Wife state lives in the corpus. Vendor + entity pages launched.$body$,
         $highlights$["PH cultural overlay strip","Ramadan mode banner","Eid preparation cards","Sadaka rhythm card","Vendor heartbeat + intelligence","/vendors + /entities pages","Wife state preferences corpus"]$highlights$::jsonb,
         2, false
  where not exists (
    select 1 from finance.app_changelog c where c.author_id = owner_id and c.version = '2026.06.T2'
  );

  insert into finance.app_changelog (author_id, version, released_at, kind, title, body, highlights, tier, is_pinned)
  select owner_id, '2026.06.T3', '2026-06-01', 'release',
         'Tier 3 — Editorial',
         $body$Letters, milestones, quiet receipts, life shifts. The corpus writes back — end-of-month letter, Sunday note, year letter, anniversary, two-month-mark, spotlight. Auto-trigger hooks populate receipts + shifts from real mutations.$body$,
         $highlights$["End-of-month, Sunday, year, anniversary, regret-mark, spotlight letters","Milestones with surfacing","Quiet receipts auto-recorded on key mutations","Life shifts auto-logged","/letters page with 4 tabs"]$highlights$::jsonb,
         3, false
  where not exists (
    select 1 from finance.app_changelog c where c.author_id = owner_id and c.version = '2026.06.T3'
  );

  insert into finance.app_changelog (author_id, version, released_at, kind, title, body, highlights, tier, is_pinned)
  select owner_id, '2026.06.T4', '2026-06-01', 'release',
         'Tier 4 — Body & behaviour',
         $body$Morning log, weekly intentions, pack rhythm, late-night cluster, post-payday surge, sleep × spend echo. The cigarette-cost translator lives in the spend modal.$body$,
         $highlights$["Morning log card with mood + mind","Weekly intentions + Journal mirror","Pack rhythm sparkline","Late-night cluster card","Post-payday surge","Sleep × spend echo","Cigarette cost translator"]$highlights$::jsonb,
         4, false
  where not exists (
    select 1 from finance.app_changelog c where c.author_id = owner_id and c.version = '2026.06.T4'
  );

  insert into finance.app_changelog (author_id, version, released_at, kind, title, body, highlights, tier, is_pinned)
  select owner_id, '2026.06.T5', '2026-06-01', 'release',
         'Tier 5 — AI conversation',
         $body$Tuesday check-in, quiet-channel watcher, project-note rate insight, year-long memory recall, Should-I-Buy. The AI mirrors you weekly without prescribing.$body$,
         $highlights$["Tuesday check-in card (private emotional ledger)","Quiet-channel watcher for silent clients","Project-note rate insight per client","One-year-ago memory recall","/should-i-buy decision aid"]$highlights$::jsonb,
         5, true
  where not exists (
    select 1 from finance.app_changelog c where c.author_id = owner_id and c.version = '2026.06.T5'
  );

  insert into finance.app_changelog (author_id, version, released_at, kind, title, body, highlights, tier, is_pinned)
  select owner_id, '2026.06.P1', '2026-06-01', 'improvement',
         'Polish pass — IA + nav + Tier 5 surfaces',
         $body$Today regrouped by intent. Sidebar / mobile / ⌘K share one taxonomy. Quiet channel + rate insight finally live on client detail pages. Vendor extractor stops mis-reading "Sent" as a real vendor. Search + profile no longer crash on open.$body$,
         $highlights$["Today: 5 grouped intent clusters","Sidebar groupings: Now / Money / People / Stories / Log","Quiet-channel banner + rate signals on /clients/[id]","Should-I-Buy quicklink in Today actions strip","Search + profile menu crashes fixed","Spending chart no longer dips below zero","Sidebar scrollbar hidden"]$highlights$::jsonb,
         null, false
  where not exists (
    select 1 from finance.app_changelog c where c.author_id = owner_id and c.version = '2026.06.P1'
  );

  insert into finance.app_changelog (author_id, version, released_at, kind, title, body, highlights, tier, is_pinned)
  select owner_id, '2026.06.P2', '2026-06-01', 'fix',
         'Save errors now show the real message',
         $body$Critical save actions (morning log, Tuesday check-in, new entity) now return structured results so the toast shows the underlying database/auth error instead of the generic "Server Components render" wrapper. Server-side errors also reach Vercel logs for diagnosis.$body$,
         $highlights$["saveMorningLogAction returns ActionResult","createEntity returns ActionResult","saveCheckinResponseAction returns ActionResult","Vendor extractor stop-words","Partial-paid pill no longer purple"]$highlights$::jsonb,
         null, false
  where not exists (
    select 1 from finance.app_changelog c where c.author_id = owner_id and c.version = '2026.06.P2'
  );
end $$;
