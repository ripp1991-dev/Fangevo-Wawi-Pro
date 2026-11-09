import { type ErrorCode, type ProblemDetails } from '@fangevo/shared';

/** Fehler der API mit stabilem Fehlercode und optionalen Feldfehlern. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

let activeCompanyId: string | null = null;
export function setActiveCompany(id: string | null): void {
  activeCompanyId = id;
}
export function getActiveCompany(): string | null {
  return activeCompanyId;
}

const FALLBACK: Partial<Record<ErrorCode, string>> = {
  RATE_LIMITED: 'Zu viele Versuche. Bitte warten Sie einen Moment.',
  INTERNAL_ERROR: 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut.',
};

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-fangevo-csrf'] = '1';
  if (activeCompanyId) headers['x-company-id'] = activeCompanyId;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'INTERNAL_ERROR', 'Keine Verbindung zum Server.');
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const p = (data ?? {}) as Partial<ProblemDetails>;
    const code = (p.code ?? 'INTERNAL_ERROR') as ErrorCode;
    const fields = Object.fromEntries((p.errors ?? []).map((e) => [e.path, e.message]));
    throw new ApiError(
      res.status,
      code,
      p.detail ?? FALLBACK[code] ?? 'Anfrage fehlgeschlagen',
      fields,
    );
  }
  return data as T;
}

export const http = {
  get: <T>(p: string) => api<T>('GET', p),
  post: <T>(p: string, b: unknown = {}) => api<T>('POST', p, b),
  put: <T>(p: string, b: unknown) => api<T>('PUT', p, b),
  patch: <T>(p: string, b: unknown) => api<T>('PATCH', p, b),
  del: <T>(p: string) => api<T>('DELETE', p),
};

export function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Ein unerwarteter Fehler ist aufgetreten.';
}
