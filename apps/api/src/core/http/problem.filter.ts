import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
  Logger,
} from '@nestjs/common';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { type ErrorCode, type ProblemDetails } from '@fangevo/shared';
import { Prisma } from '@fangevo/database';
import { AppError } from './errors';

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** Wandelt alle Fehler in RFC-9457-"Problem Details" um. Interna gelangen nie zum Client. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  constructor(@Inject(Logger) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const req = host.switchToHttp().getRequest<FastifyRequest>();
    const problem = this.toProblem(exception);
    if (problem.status >= 500) {
      this.logger.error(
        { err: exception, url: req.url, method: req.method },
        'Unerwarteter Fehler',
      );
    }
    void reply
      .status(problem.status)
      .header('content-type', 'application/problem+json')
      .send(problem);
  }

  private toProblem(e: unknown): ProblemDetails {
    if (e instanceof AppError) {
      return {
        type: 'about:blank',
        title: e.code,
        status: e.getStatus(),
        code: e.code,
        detail: (e.getResponse() as { detail?: string }).detail,
        errors: e.errors,
      };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002')
        return {
          type: 'about:blank',
          title: 'CONFLICT',
          status: 409,
          code: 'CONFLICT',
          detail: 'Eintrag existiert bereits',
        };
      if (e.code === 'P2025')
        return {
          type: 'about:blank',
          title: 'NOT_FOUND',
          status: 404,
          code: 'NOT_FOUND',
          detail: 'Nicht gefunden',
        };
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const code = STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'FORBIDDEN');
      return {
        type: 'about:blank',
        title: code,
        status,
        code,
        detail: status >= 500 ? undefined : e.message,
      };
    }
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 429)
      return {
        type: 'about:blank',
        title: 'RATE_LIMITED',
        status: 429,
        code: 'RATE_LIMITED',
        detail: 'Zu viele Anfragen. Bitte kurz warten.',
      };
    if (status && status >= 400 && status < 500) {
      return {
        type: 'about:blank',
        title: 'VALIDATION_FAILED',
        status,
        code: 'VALIDATION_FAILED',
        detail: 'Ungültige Anfrage',
      };
    }
    return {
      type: 'about:blank',
      title: 'INTERNAL_ERROR',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'Interner Fehler',
    };
  }
}
