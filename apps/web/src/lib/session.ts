import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Permission } from '@fangevo/shared';
import { ApiError, http, setActiveCompany } from './api';
import { type SessionData } from './types';

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async (): Promise<SessionData | null> => {
    try {
      return await http.get<SessionData>('/auth/session');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },
  staleTime: 30_000,
});

export function useSession(): SessionData {
  const { data } = useQuery(sessionQuery);
  if (!data) throw new Error('Keine Sitzung');
  return data;
}

export function useCan(): (p: Permission) => boolean {
  const s = useSession();
  return (p) => !!s.account?.permissions.includes(p);
}

export function useRefreshSession(): () => Promise<void> {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries();
  };
}

// ───── Aktive Firma (pro Account im Browser gemerkt, serverseitig geprüft) ─────

const key = (accountId: string) => `fe-company:${accountId}`;

export function resolveActiveCompany(s: SessionData): string | null {
  const acc = s.account;
  if (!acc || !acc.companies.length) {
    setActiveCompany(null);
    return null;
  }
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(key(acc.id));
  } catch {
    /* Speicher nicht verfügbar */
  }
  const known = acc.companies.find((c) => c.id === stored)?.id;
  const id = known ?? acc.companies[0]!.id;
  // Erste Wahl merken, damit neu angelegte Firmen die aktive Firma nicht verschieben
  if (!known) storeActiveCompany(acc.id, id);
  setActiveCompany(id);
  return id;
}

export function storeActiveCompany(accountId: string, companyId: string): void {
  try {
    localStorage.setItem(key(accountId), companyId);
  } catch {
    /* Speicher nicht verfügbar */
  }
  setActiveCompany(companyId);
}
