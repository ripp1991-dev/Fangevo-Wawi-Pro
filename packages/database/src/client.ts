import { PrismaClient } from '@prisma/client';

export function createPrismaClient(url?: string): PrismaClient {
  return new PrismaClient({
    datasources: url ? { db: { url } } : undefined,
    log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
  });
}
