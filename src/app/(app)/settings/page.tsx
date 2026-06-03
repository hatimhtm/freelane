import Link from "next/link";
import {
  Bell,
  ChevronRight,
  Database,
  Heart,
  Info,
  RefreshCw,
  Repeat,
  ShieldCheck,
  Sparkles,
  Stars,
  Tags,
  User,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { getLastSeenVersion } from "@/lib/data/queries";
import { loadChangelog } from "@/lib/changelog/load";

export const metadata = { title: "Settings" };

// Settings landing page — 12-subtab control center. Was a flat single-page
// form stack until the Settings workflow split each domain off into its own
// /settings/<slug> subroute. The home tile-grid is now navigation-only;
// every form moved to its dedicated child page.
//
// Updates + Notifications already had their own routes from prior workflows
// (Whats-New, Notifications). They surface in this grid alongside the new
// 10 subroutes so the user sees ONE consistent control center.

type Subtab = {
  slug: string;
  title: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
};

const SUBTABS: Subtab[] = [
  { slug: "profile",      title: "Profile",          hint: "Display name, timezone, currency default.",                 icon: User },
  { slug: "wallets",      title: "Wallets",          hint: "Holding wallets, brand picker, opening balances, FX rates.", icon: Wallet },
  { slug: "cycles",       title: "Cycles",           hint: "Recurring subscriptions, bills, and other rhythmic spends.", icon: Repeat },
  { slug: "body",         title: "Body & Wellbeing", hint: "Measurements, sleep, smoking, and daily habits.",            icon: Heart },
  { slug: "faith",        title: "Faith",            hint: "Prayer times, qibla, Hijri date, Ramadan windows.",          icon: Stars },
  { slug: "tags",         title: "Tags",             hint: "Categories and labels the AI uses to make sense of spends.", icon: Tags },
  { slug: "ai",           title: "AI",               hint: "What the AI remembers about you, your clients, and vendors.", icon: Sparkles },
  { slug: "notifications",title: "Notifications",    hint: "Retention, browser push, and per-kind delivery toggles.",    icon: Bell },
  { slug: "privacy",      title: "Privacy & Data",   hint: "Export everything. Delete your account.",                    icon: ShieldCheck },
  { slug: "updates",      title: "Updates",          hint: "Every release that lands in Freelane.",                      icon: RefreshCw },
  { slug: "advanced",     title: "Advanced",         hint: "Feature flags, dev-mode toggles, and other power switches.", icon: Database },
  { slug: "about",        title: "About",            hint: "Version, links, build info.",                                icon: Info },
];

export default async function SettingsPage() {
  const { currentVersion } = await loadChangelog();
  const lastSeenVersion = await getLastSeenVersion().catch(() => null);
  const hasUpdate =
    !lastSeenVersion || lastSeenVersion !== currentVersion;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Settings"
        description="Twelve doors to the parts of Freelane you control."
      />

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SUBTABS.map((tab) => {
          const Icon = tab.icon;
          const showDot = tab.slug === "updates" && hasUpdate;
          const trailing =
            tab.slug === "updates" ? (
              <span className="text-[11px] font-normal text-muted-foreground tabular">
                {currentVersion}
              </span>
            ) : null;
          return (
            <Link
              key={tab.slug}
              href={`/settings/${tab.slug}`}
              className="group flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-5 transition-colors hover:bg-foreground/[0.025]"
            >
              <span className="relative grid size-10 shrink-0 place-items-center rounded-xl border border-border/60 bg-muted/30 text-muted-foreground group-hover:text-foreground">
                <Icon className="h-4 w-4" />
                {showDot && (
                  <span
                    aria-label="New release available"
                    className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-500"
                  />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{tab.title}</span>
                  {trailing}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
                  {tab.hint}
                </p>
              </div>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
