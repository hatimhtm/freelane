// Maps a virtual-feed row back to a canonical surface URL. Every row in
// /activity is clickable; this resolver decides where the click lands.
// Mismatches between query-param surfaces and these hrefs mean rows click
// into nothing — keep this in sync when surfaces change their deep-link
// params.

export type SourceDetailPayload = {
  page_key?: string | null;
  session_id?: string | null;
  link_url?: string | null;
  [k: string]: unknown;
};

export function sourceDetailHref(
  source_table: string,
  source_id: string | null,
  payload?: SourceDetailPayload | null,
): string {
  const id = source_id ?? "";
  switch (source_table) {
    case "spends":
      return id ? `/spending?spend=${id}` : "/spending";
    case "withdrawals":
      return id ? `/payments?withdrawal=${id}` : "/payments";
    case "sadaka_ledger":
      return id ? `/sadaka?row=${id}` : "/sadaka";
    case "planned_spends":
      return id ? `/plans?plan=${id}` : "/plans";
    case "notifications_inbox": {
      const link = payload?.link_url;
      if (link && typeof link === "string") return link;
      return "/notifications";
    }
    case "chat_messages": {
      const pageKey = payload?.page_key ?? "today";
      const sessionId = payload?.session_id;
      const base =
        pageKey === "dashboard"
          ? "/dashboard"
          : pageKey === "should_i_buy"
            ? "/"
            : `/${pageKey}`;
      return sessionId ? `${base}?chat=${sessionId}` : base;
    }
    case "letters":
      return id ? `/letters?letter=${id}` : "/letters";
    case "loans":
    case "loan_returns":
    case "loan_forgivals":
      return id ? `/spending?loan=${id}` : "/spending";
    case "ai_user_facts":
      return "/settings/ai";
    case "vendors":
      return id ? `/spending/vendors?vendor=${id}` : "/spending/vendors";
    case "entities":
      return id ? `/clients/people?entity=${id}` : "/clients/people";
    case "morning_log":
    case "wellbeing_checkins":
    case "diary_entries":
      return "/today";
    default:
      return "/activity";
  }
}
