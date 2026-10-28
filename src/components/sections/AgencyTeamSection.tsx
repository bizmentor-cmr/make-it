"use client";

// Make It — AgencyTeamSection ("👥 Équipe" agency nav item).
//
// Shows the list of agency members (name, email, role, assigned clients count),
// an invite button (opens a dialog with email + role select), edit role, and
// remove. Mutations are admin-only — the API enforces this; the UI also hides
// buttons for non-admins.
//
// Routes used:
//   - GET  /api/agency/members  → list
//   - POST /api/agency/members  → invite {email, role}
//   - PATCH /api/agency/members/[id] {role}
//   - DELETE /api/agency/members/[id]

import { useEffect, useState, useCallback } from "react";
import { useAppStore } from "@/store/app-store";
import { useAuth } from "@/lib/auth-context";
import { apiGet, apiPost, apiPatch, apiDelete, apiTry, ApiError } from "@/lib/api-client";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  UserPlus,
  Loader2,
  Shield,
  Crown,
  Pencil,
  Trash2,
  Mail,
  Building2,
  Users,
} from "lucide-react";

type AgencyMember = {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: "admin" | "manager" | "creative";
  assignedClientsCount: number;
  createdAt: string;
};

type AgencyInfo = {
  agency: {
    id: string;
    name: string;
    slug: string;
    status: string;
    mode: string;
    createdAt: string;
  };
  role: "admin" | "manager" | "creative";
  wallet: {
    totalCredits: number;
    reservedCredits: number;
    totalConsumed: number;
    available: number;
  };
  clientCount: number;
  memberCount: number;
} | null;

const ROLE_LABEL: Record<"admin" | "manager" | "creative", string> = {
  admin: "Administrateur",
  manager: "Manager",
  creative: "Créatif",
};

const ROLE_ICON: Record<"admin" | "manager" | "creative", React.ReactNode> = {
  admin: <Crown className="h-3 w-3" />,
  manager: <Shield className="h-3 w-3" />,
  creative: <Pencil className="h-3 w-3" />,
};

function initials(name: string | null, email: string) {
  if (name) {
    return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export function AgencyTeamSection() {
  const { setActiveAgencyId } = useAppStore();
  const { user } = useAuth();
  const [agency, setAgency] = useState<AgencyInfo>(null);
  const [members, setMembers] = useState<AgencyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"manager" | "creative">("creative");
  const [inviting, setInviting] = useState(false);

  // Editing role state.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<"admin" | "manager" | "creative">("creative");
  const [savingRole, setSavingRole] = useState(false);

  // Removing state.
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadAgency = useCallback(async () => {
    const res = await apiTry(
      async () => apiGet<AgencyInfo>("/api/agency"),
      null as AgencyInfo
    );
    setAgency(res);
    if (res?.agency.id) setActiveAgencyId(res.agency.id);
  }, [setActiveAgencyId]);

  const loadMembers = useCallback(async () => {
    const res = await apiTry(
      async () => apiGet<{ members: AgencyMember[] }>("/api/agency/members"),
      { members: [] as AgencyMember[] }
    );
    setMembers(res.members ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([loadAgency(), loadMembers()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAgency, loadMembers]);

  const myRole = agency?.role ?? null;
  const isAdmin = myRole === "admin";

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (inviting) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      toast.error("Email requis");
      return;
    }
    setInviting(true);
    try {
      const res = await apiPost<{ member: AgencyMember | null; pending: boolean }>(
        "/api/agency/members",
        { email, role: inviteRole }
      );
      if (res.pending || !res.member) {
        toast.success("Invitation enregistrée", {
          description: `${email} sera ajouté dès qu'il créera son compte Make It.`,
        });
      } else {
        toast.success("Membre ajouté", {
          description: `${res.member.name ?? res.member.email} est maintenant ${ROLE_LABEL[res.member.role]}.`,
        });
        await loadMembers();
      }
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("creative");
    } catch (e) {
      toast.error("Impossible d'inviter ce membre", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setInviting(false);
    }
  }

  async function handleSaveRole(memberId: string) {
    if (savingRole) return;
    setSavingRole(true);
    try {
      await apiPatch(`/api/agency/members/${memberId}`, { role: editRole });
      toast.success("Rôle mis à jour", { description: ROLE_LABEL[editRole] });
      setEditingId(null);
      await loadMembers();
    } catch (e) {
      toast.error("Échec du changement de rôle", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSavingRole(false);
    }
  }

  async function handleRemove(member: AgencyMember) {
    if (removingId) return;
    setRemovingId(member.id);
    try {
      await apiDelete(`/api/agency/members/${member.id}`);
      toast.success("Membre retiré", {
        description: member.name ?? member.email,
      });
      await loadMembers();
    } catch (e) {
      toast.error("Impossible de retirer ce membre", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setRemovingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Chargement de l'équipe…</span>
        </div>
      </div>
    );
  }

  if (!agency) {
    return (
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Agence"
          title="Équipe"
          description="Gérez les membres de votre agence."
        />
        <div className="surface-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Mode agence non activé. Activez-le depuis les Paramètres.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Agence"
        title="Équipe"
        description="Invitez des managers et des créatifs, attribuez-leur l'accès aux clients."
        actions={
          isAdmin ? (
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
                >
                  <UserPlus className="h-4 w-4" />
                  Inviter un membre
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Inviter un membre</DialogTitle>
                  <DialogDescription>
                    L'utilisateur recevra un accès à l'agence avec le rôle choisi.
                    S'il n'a pas encore de compte Make It, il devra en créer un
                    avec le même email.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleInvite} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input
                      id="invite-email"
                      type="email"
                      placeholder="membre@exemple.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="h-10"
                      required
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-role">Rôle</Label>
                    <Select
                      value={inviteRole}
                      onValueChange={(v) =>
                        setInviteRole(v as "manager" | "creative")
                      }
                    >
                      <SelectTrigger id="invite-role" className="h-10 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manager">Manager — peut gérer tous les clients</SelectItem>
                        <SelectItem value="creative">Créatif — accès aux clients assignés</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setInviteOpen(false)}
                      disabled={inviting}
                    >
                      Annuler
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={inviting}
                      className="bg-[color:var(--ink)] text-[color:var(--primary-foreground)] hover:opacity-90"
                    >
                      {inviting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Invitation…
                        </>
                      ) : (
                        <>
                          <Mail className="h-4 w-4" /> Inviter
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Membres"
          value={agency.memberCount}
          hint="Actifs dans l'agence"
          icon={<Users className="h-4 w-4" />}
        />
        <SummaryCard
          label="Clients"
          value={agency.clientCount}
          hint="Dans le portfolio"
          icon={<Building2 className="h-4 w-4" />}
        />
        <SummaryCard
          label="Crédits agence"
          value={agency.wallet.available}
          hint={`${agency.wallet.totalConsumed.toLocaleString("fr-FR")} consommés`}
          icon={<Shield className="h-4 w-4" />}
        />
      </div>

      {/* Members table */}
      <section className="surface-card p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Membres ({members.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              {isAdmin
                ? "Vous pouvez inviter, modifier les rôles et retirer des membres."
                : "Lecture seule — seuls les administrateurs peuvent modifier."}
            </p>
          </div>
        </div>

        <ul className="divide-y divide-border">
          {members.length === 0 && (
            <li className="py-8 text-center text-sm text-muted-foreground">
              Aucun membre pour l'instant.
            </li>
          )}
          {members.map((m) => {
            const isMe = m.userId === user?.id;
            const isEditing = editingId === m.id;
            return (
              <li
                key={m.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar className="h-10 w-10 border border-border">
                    <AvatarFallback className="bg-[color:var(--accent)] text-[color:var(--accent-foreground)] text-xs font-semibold">
                      {initials(m.name, m.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {m.name ?? m.email}
                      {isMe && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-[color:var(--accent)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--accent-foreground)]">
                          Vous
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  </div>
                  <span className="hidden sm:inline text-xs text-muted-foreground">
                    {m.assignedClientsCount} client{m.assignedClientsCount > 1 ? "s" : ""}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={editRole}
                        onValueChange={(v) =>
                          setEditRole(v as "admin" | "manager" | "creative")
                        }
                      >
                        <SelectTrigger className="h-8 w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Administrateur</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="creative">Créatif</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2"
                        onClick={() => setEditingId(null)}
                        disabled={savingRole}
                      >
                        Annuler
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 bg-[color:var(--ink)] px-2 text-[color:var(--primary-foreground)] hover:opacity-90"
                        onClick={() => handleSaveRole(m.id)}
                        disabled={savingRole}
                      >
                        {savingRole ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          "OK"
                        )}
                      </Button>
                    </div>
                  ) : (
                    <RoleBadge role={m.role} />
                  )}

                  {isAdmin && !isEditing && !isMe && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Modifier le rôle"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => {
                          setEditingId(m.id);
                          setEditRole(m.role);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            type="button"
                            aria-label="Retirer le membre"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Retirer ce membre ?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {m.name ?? m.email} perdra l'accès à l'agence et à
                              tous les clients assignés. Cette action est
                              réversible (il faudra le réinviter).
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleRemove(m)}
                              className="bg-rose-600 text-white hover:bg-rose-700"
                            >
                              Retirer
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function RoleBadge({ role }: { role: "admin" | "manager" | "creative" }) {
  const tone: Record<"admin" | "manager" | "creative", string> = {
    admin: "bg-[color:var(--accent)] text-[color:var(--accent-foreground)] border-[color:var(--emerald-accent)]/30",
    manager: "bg-muted text-foreground border-border",
    creative: "bg-muted/60 text-muted-foreground border-border",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        tone[role]
      )}
    >
      {ROLE_ICON[role]}
      {ROLE_LABEL[role]}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="surface-card flex items-center gap-3 p-4">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[color:var(--accent)] text-[color:var(--accent-foreground)]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums text-foreground">
          {value.toLocaleString("fr-FR")}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
