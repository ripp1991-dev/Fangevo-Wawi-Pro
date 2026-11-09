/** Stabile Fehlercodes der API. Werden im Feld `code` der Problem-Details-Antwort geliefert. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'EMAIL_NOT_VERIFIED',
  'MFA_REQUIRED',
  'MFA_INVALID',
  'SESSION_EXPIRED',
  'CSRF_HEADER_MISSING',
  'FORBIDDEN',
  'PERMISSION_DENIED',
  'MODULE_NOT_LICENSED',
  'LICENSE_LIMIT_REACHED',
  'ACCOUNT_SUSPENDED',
  'COMPANY_ACCESS_DENIED',
  'COMPANY_REQUIRED',
  'NOT_FOUND',
  'CONFLICT',
  'TOKEN_INVALID',
  'LAST_OWNER',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  errors?: { path: string; message: string }[];
}
