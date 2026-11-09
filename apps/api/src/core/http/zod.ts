import { type PipeTransform } from '@nestjs/common';
import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';
import { AppError } from './errors';

/** Validiert Eingaben mit einem Zod-Schema. Unbekannte Felder werden verworfen. */
export class ZodPipe<T extends ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        'Eingaben sind ungültig',
        r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return r.data;
  }
}

export const zodPipe = <T extends ZodType>(s: T) => new ZodPipe(s);

function jsonSchema(s: ZodType): Record<string, unknown> {
  return z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
}

/** OpenAPI-Dokumentation des Request-Bodys aus dem Zod-Schema. */
export const ApiZodBody = (s: ZodType) => applyDecorators(ApiBody({ schema: jsonSchema(s) }));

export const ApiZodQuery = (name: string, required = false) =>
  applyDecorators(ApiQuery({ name, required }));

export const uuidParam = zodPipe(z.uuid());
