---
name: feedback-verify-against-live-store
description: Verify Freelane data-layer fixes against the live SwiftData store with sqlite3 before shipping — theory-only fixes have shipped wrong twice
metadata:
  type: feedback
---

For Freelane, never ship a fix to the fact/memory/notification layer on reasoning alone. Read the
live store first:

```
sqlite3 "$HOME/Library/Application Support/Freelane/Freelane.store" \
  "SELECT ZID, ZSUBJECTKIND, ZSUBJECTID, ZKEY, ZVALUE, ZARCHIVEDAT, ZSOURCE FROM ZAIFACT;"
```

**Why:** on 2026-07-26 a repeating "What kind of place is X?" notification was diagnosed twice from
code alone and fixed twice wrongly. The first fix chased a slug mismatch that was real but not the
cause; its migration then skipped archived rows and wrote recovered rows to an address the reader
never queries, so it silently did nothing. The actual cause was only visible by inspecting the
store: `Memory.remember` gated every write on `AIJSON.isRealText`, which requires ≥10 characters, so
"Groceries" (9) and nearly every choice chip in the app were discarded in silence.

**How to apply:** dump the relevant table before diagnosing; simulate any migration in Python
against a copy of the store and print what it would write; after installing, re-query to confirm the
rows landed. State findings from the query output, not from reading the code. See
[[project_stash]] for the sibling app's conventions and [[feedback_working_style]].
