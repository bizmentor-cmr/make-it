// Make It — Tiny fetch wrapper for the backend API.
// All routes are same-origin relative paths. The backend resolves the active
// workspace from the session (NextAuth cookie) + optional X-Workspace-Id header,
// so we don't need to forward the workspace id on every call. We still expose
// `setWorkspaceHeader` so the auth context can pin the active workspace for
// multi-workspace users (it's a no-op when not set).
//
// Every backend response uses the { success, data, meta, error } envelope.
// `apiGet` / `apiPost` / `apiPatch` / `apiDelete` return `data` on success
// (or the full payload if `data` is missing — rare) and throw an `ApiError`
// when `success === false` or the network call fails.

export class ApiError extends Error {
  status: number;
  code?: string;
  meta?: unknown;
  constructor(message: string, opts: { status?: number; code?: string; meta?: unknown } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status ?? 0;
    this.code = opts.code;
    this.meta = opts.meta;
  }
}

// Optional workspace pin (set by AuthProvider once /api/auth/me resolves).
let workspaceHeader: string | null = null;
export function setWorkspaceHeader(id: string | null) {
  workspaceHeader = id;
}

// Optional silent mode — when true, errors are still thrown but no toast is
// fired by the wrapper (used by background polls). Toasts are emitted by the
// caller via sonner.
let silent = false;
export function setSilent(v: boolean) {
  silent = v;
}

type Envelope = {
  success?: boolean;
  data?: unknown;
  meta?: unknown;
  error?: string | { message?: string; code?: string } | null;
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init?: RequestInit
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (workspaceHeader) headers["x-workspace-id"] = workspaceHeader;

  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: payload,
      credentials: "include",
      ...init,
    });
  } catch (e) {
    throw new ApiError(
      e instanceof Error ? e.message : "Échec réseau",
      { status: 0 }
    );
  }

  // Empty 204 → return null
  if (res.status === 204) return null as T;

  let env: Envelope | null = null;
  const text = await res.text();
  if (text) {
    try {
      env = JSON.parse(text) as Envelope;
    } catch {
      env = null;
    }
  }

  if (!env) {
    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status}`, { status: res.status });
    }
    return null as T;
  }

  const ok = env.success !== false && res.ok;
  if (!ok) {
    const errStr =
      typeof env.error === "string"
        ? env.error
        : env.error?.message ?? `HTTP ${res.status}`;
    const code =
      typeof env.error === "object" && env.error ? env.error.code : undefined;
    throw new ApiError(errStr, { status: res.status, code, meta: env.meta });
  }

  // Prefer `data`, fall back to the whole envelope minus success/error.
  if (env.data !== undefined) return env.data as T;
  const { success: _s, error: _e, ...rest } = env;
  return rest as T;
}

export function apiGet<T = unknown>(path: string, init?: RequestInit) {
  return request<T>("GET", path, undefined, init);
}

export function apiPost<T = unknown>(
  path: string,
  body?: unknown,
  init?: RequestInit
) {
  return request<T>("POST", path, body, init);
}

export function apiPatch<T = unknown>(
  path: string,
  body?: unknown,
  init?: RequestInit
) {
  return request<T>("PATCH", path, body, init);
}

export function apiDelete<T = unknown>(path: string, init?: RequestInit) {
  return request<T>("DELETE", path, undefined, init);
}

// Helper: try an API call, fall back to a mock value on error.
// Used everywhere so the UI never breaks when the backend is unreachable.
export async function apiTry<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!silent && typeof window !== "undefined") {
      // Defer the toast import so this file can be loaded on the server.
      import("sonner").then(({ toast }) =>
        toast.error("Données indisponibles", {
          description:
            e instanceof Error ? e.message : "Le backend est injoignable.",
        })
      );
    }
    return fallback;
  }
}

// ─── Typed shapes for the most common envelopes ─────────────────────────────

export type Wallet = {
  subscriptionCredits: number;
  purchasedCredits: number;
  reservedCredits: number;
  totalConsumed: number;
  available: number;
  renewalDate?: string | null;
  renewalInDays?: number | null;
  plan?: {
    id: string;
    name: string;
    includedCredits: number;
    monthlyPrice: number;
  } | null;
};

export type MeResponse = {
  user: { id: string; email: string; name: string };
  workspace: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    role: string;
  } | null;
  wallet: Wallet | null;
  workspaces: { id: string; name: string; slug: string; plan: string; role: string }[];
};

export type JobProgress = {
  id: string;
  status: string;
  progress: number;
  currentStep: string | null;
  consumedCredits: number;
  estimatedRemainingCredits?: number;
};
