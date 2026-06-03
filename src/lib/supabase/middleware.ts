import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api/cron is intentionally public so scheduled invocations (which arrive
// without session cookies) can reach the cron handlers. Each cron route
// does its own CRON_SECRET Bearer check — do NOT broaden this to all /api.
const PUBLIC_PATHS = [
  "/login",
  "/_next",
  "/favicon.ico",
  "/icon",
  "/apple-icon",
  "/api/cron",
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "finance" },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // auth.getUser() is a network call to Supabase that runs on EVERY request.
  // If it throws (a transient blip — common right when the PWA reloads after
  // the OS suspended its network on app-switch), don't let it 500 the whole
  // request. Proceed instead: the (app) layout re-checks auth server-side and
  // redirects to /login if the user genuinely isn't signed in, so a momentary
  // pass-through is safe.
  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    return response;
  }

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
