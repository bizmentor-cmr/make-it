"use client";

import { useAppStore, type SectionKey } from "@/store/app-store";
import { MakeItMark } from "@/components/shared/AIBadge";
import { getClientColor } from "@/lib/client-colors";
import { cn } from "@/lib/utils";
import {
  Settings,
  Home,
  Brain,
  Sparkles,
  CalendarDays,
  Megaphone,
  MessageSquare,
  BarChart3,
  Palette,
  FolderOpen,
  X,
  Building2,
  CreditCard,
  Users,
  MessagesSquare,
  Library,
  Sparkles as StudioIcon,
} from "lucide-react";

// The 10 client-level nav items (always visible — they apply to the active
// client workspace in agency mode, or to the user's own workspace in solo).
const NAV_CLIENT: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: "home", label: "Accueil", icon: <Home className="h-4 w-4" /> },
  { key: "strategy", label: "Stratégie", icon: <Brain className="h-4 w-4" /> },
  { key: "create", label: "Créer", icon: <Sparkles className="h-4 w-4" /> },
  { key: "planning", label: "Planning", icon: <CalendarDays className="h-4 w-4" /> },
  { key: "campaigns", label: "Campagnes", icon: <Megaphone className="h-4 w-4" /> },
  { key: "messages", label: "Messages", icon: <MessageSquare className="h-4 w-4" /> },
  { key: "internal-messages", label: "Communication interne", icon: <MessagesSquare className="h-4 w-4" /> },
  { key: "performance", label: "Performances", icon: <BarChart3 className="h-4 w-4" /> },
  { key: "brand", label: "Ma marque", icon: <Palette className="h-4 w-4" /> },
  { key: "library", label: "Bibliothèque", icon: <FolderOpen className="h-4 w-4" /> },
];

// Agency-level nav items (only visible in agency mode).
const NAV_AGENCY: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: "agency-portfolio", label: "Portfolio Agence", icon: <Building2 className="h-4 w-4" /> },
  { key: "agency-library", label: "Bibliothèque Agence", icon: <Library className="h-4 w-4" /> },
  { key: "agency-credits", label: "Crédits Agence", icon: <CreditCard className="h-4 w-4" /> },
  { key: "agency-team", label: "Équipe", icon: <Users className="h-4 w-4" /> },
];

export function Sidebar() {
  const {
    activeSection,
    setActiveSection,
    sidebarOpen,
    setSidebarOpen,
    mode,
    activeClientId,
  } = useAppStore();
  const isAgency = mode === "agency";

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-[color:var(--sidebar)] px-3 py-4 flex flex-col transition-transform md:translate-x-0 md:static md:z-auto",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-2">
          <MakeItMark />
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted md:hidden"
            aria-label="Fermer le menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="mt-5 flex-1 space-y-1 overflow-y-auto scroll-premium">
          {isAgency && (
            <>
              {/* Agency-level sections (top of sidebar). */}
              <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Agence
              </p>
              {NAV_AGENCY.map((item) => (
                <NavButton
                  key={item.key}
                  item={item}
                  active={activeSection === item.key}
                  onClick={() => setActiveSection(item.key)}
                />
              ))}

              {/* Separator + Client header. */}
              <div className="my-3 border-t border-border" />
              <div className="rounded-xl border border-border/60 p-2.5">
                <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Société cliente
                </p>
                <div className="mt-1 flex items-center gap-2">
                  {/* Colored client card — left accent stripe + dot so the
                      operator instantly sees which workspace they're editing. */}
                  {activeClientId ? (
                    <>
                      <span
                        className="inline-block h-8 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: getClientColor(activeClientId).hex }}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          Client actif
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Utilisez ⌘K pour basculer.
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        Aucun client sélectionné
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Utilisez ⌘K pour basculer.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Client-level sections (always visible — they apply to the active
              client in agency mode, or to the user's own workspace in solo). */}
          {NAV_CLIENT.map((item) => (
            <NavButton
              key={item.key}
              item={item}
              active={activeSection === item.key}
              onClick={() => setActiveSection(item.key)}
            />
          ))}
        </nav>

        <div className="mt-2 space-y-1 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => {
              setActiveSection("studio");
            }}
            aria-current={activeSection === "studio" ? "page" : undefined}
            className={cn(
              "group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              activeSection === "studio"
                ? "bg-[color:var(--ink)] text-[color:var(--sidebar-primary-foreground)]"
                : "text-[color:var(--sidebar-foreground)] hover:bg-[color:var(--sidebar-accent)]"
            )}
          >
            <span className={activeSection === "studio" ? "text-[color:var(--sidebar-primary-foreground)]" : "text-muted-foreground group-hover:text-foreground"}>
              <StudioIcon className="h-4 w-4" />
            </span>
            Make it Studio
          </button>

          <NavButton
            item={{
              key: "settings",
              label: "Paramètres",
              icon: <Settings className="h-4 w-4" />,
            }}
            active={activeSection === "settings"}
            onClick={() => setActiveSection("settings")}
          />
        </div>

        {!isAgency && (
          <div className="mt-3 rounded-xl bg-gradient-to-br from-[color:var(--accent)] to-[color:var(--accent)]/50 p-3">
            <p className="text-xs font-medium text-[color:var(--accent-foreground)]">Passez au plan Pro</p>
            <p className="mt-0.5 text-[11px] text-[color:var(--accent-foreground)]/80">
              Débloquez 25k crédits / mois et les analyses avancées.
            </p>
            <button className="mt-2 inline-flex items-center rounded-lg bg-[color:var(--ink)] px-2.5 py-1.5 text-[11px] font-medium text-[color:var(--primary-foreground)]">
              Découvrir
            </button>
          </div>
        )}

        {isAgency && (
          <div className="mt-3 rounded-xl bg-gradient-to-br from-[color:var(--accent)] to-[color:var(--accent)]/50 p-3">
            <p className="text-xs font-medium text-[color:var(--accent-foreground)]">
              Make It for Agencies
            </p>
            <p className="mt-0.5 text-[11px] text-[color:var(--accent-foreground)]/80">
              Gérez tous vos clients depuis un seul compte.
            </p>
          </div>
        )}
      </aside>
    </>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: { key: SectionKey; label: string; icon: React.ReactNode };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-[color:var(--ink)] text-[color:var(--sidebar-primary-foreground)]"
          : "text-[color:var(--sidebar-foreground)] hover:bg-[color:var(--sidebar-accent)]"
      )}
    >
      <span
        className={cn(
          active
            ? "text-[color:var(--sidebar-primary-foreground)]"
            : "text-muted-foreground group-hover:text-foreground"
        )}
      >
        {item.icon}
      </span>
      {item.label}
    </button>
  );
}
