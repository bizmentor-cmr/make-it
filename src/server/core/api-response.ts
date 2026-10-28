// Make It — Unified API response contract.
// Every API route returns this envelope: { success, data, meta, error }.

import { NextResponse } from "next/server";

export type ApiEnvelope<T = unknown> = {
  success: boolean;
  data: T | null;
  meta: Record<string, unknown> | null;
  error: {
    code: string;
    message: string;
    details?: unknown;
  } | null;
};

export function ok<T>(data: T, meta?: Record<string, unknown>, init?: ResponseInit) {
  const body: ApiEnvelope<T> = { success: true, data, meta: meta ?? null, error: null };
  return NextResponse.json(body, init ?? { status: 200 });
}

export function fail(
  message: string,
  opts: { code?: string; status?: number; details?: unknown } = {}
) {
  const body: ApiEnvelope = {
    success: false,
    data: null,
    meta: null,
    error: { code: opts.code ?? "error", message, details: opts.details },
  };
  return NextResponse.json(body, { status: opts.status ?? 400 });
}

export function unauthorized(message = "Non authentifié") {
  return fail(message, { code: "unauthorized", status: 401 });
}

export function forbidden(message = "Accès refusé") {
  return fail(message, { code: "forbidden", status: 403 });
}

export function notFound(message = "Introuvable") {
  return fail(message, { code: "not_found", status: 404 });
}

export function badRequest(message: string, details?: unknown) {
  return fail(message, { code: "bad_request", status: 400, details });
}

export function serverError(message = "Erreur serveur", details?: unknown) {
  return fail(message, { code: "server_error", status: 500, details });
}

export function rateLimited(message = "Trop de requêtes") {
  return fail(message, { code: "rate_limited", status: 429 });
}
