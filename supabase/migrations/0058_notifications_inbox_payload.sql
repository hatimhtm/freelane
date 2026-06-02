-- Freelane Notifications — payload + answer columns for interactive kinds.
--
-- payload is a free-form jsonb consumed by the click-routing registry
-- (src/lib/notifications/click-routing.tsx). Canonical shapes today:
--   { choices: string[] }              -> MultiChoiceAnswer renderer
--   { freeText: true, placeholder? }   -> FreeTextAnswer renderer
--   { kind_specific: { ... } }         -> opaque per-kind extras
--
-- answer is the user's response when an interactive renderer fires. Stored
-- as jsonb so a multi-choice answer (single string) and a free-text answer
-- (string) and any future multi-select (string[]) can share one column.
-- Both columns are nullable; existing rows remain valid.

alter table finance.notifications_inbox
  add column if not exists payload jsonb;

alter table finance.notifications_inbox
  add column if not exists answer jsonb;

comment on column finance.notifications_inbox.payload is
  'Interactive payload — { choices?: string[], freeText?: boolean, placeholder?: string, kind_specific?: jsonb } consumed by click-routing renderers.';

comment on column finance.notifications_inbox.answer is
  'User-submitted answer when notification triggered MultiChoiceAnswer or FreeTextAnswer.';
