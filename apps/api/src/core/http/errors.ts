import { HttpException } from '@nestjs/common';
import { type ErrorCode } from '@fangevo/shared';

/** Fachlicher Fehler mit stabilem Fehlercode (wird als Problem Details ausgegeben). */
export class AppError extends HttpException {
  constructor(
    status: number,
    public readonly code: ErrorCode,
    detail?: string,
    public readonly errors?: { path: string; message: string }[],
  ) {
    super({ code, detail }, status);
    this.message = detail ?? code;
  }
}

export const Errors = {
  unauthenticated: (detail = 'Bitte anmelden') => new AppError(401, 'UNAUTHENTICATED', detail),
  forbidden: (code: ErrorCode = 'FORBIDDEN', detail?: string) => new AppError(403, code, detail),
  notFound: (detail = 'Nicht gefunden') => new AppError(404, 'NOT_FOUND', detail),
  conflict: (detail: string) => new AppError(409, 'CONFLICT', detail),
  invalidToken: () => new AppError(400, 'TOKEN_INVALID', 'Der Link ist ungültig oder abgelaufen'),
};
