import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { type AppConfig } from './config';
import { RedisService } from './core/database/redis.service';

export const CSRF_HEADER = 'x-fangevo-csrf';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function createApp(config: AppConfig): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config),
    new FastifyAdapter({ trustProxy: config.isProd, bodyLimit: 1_048_576 }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(PinoLogger));
  // Datei-Uploads (Import) dürfen größer sein als normale Anfragen (1 MB)
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRoute', (route) => {
      if (route.method === 'POST' && route.url === '/api/v1/imports')
        route.bodyLimit = 15 * 1024 * 1024;
    });
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // API-Antworten dürfen nicht in fremde oder eigene Rahmen eingebettet werden (Clickjacking)
        frameAncestors: ["'none'"],
      },
    },
  });
  if (!config.RATE_LIMIT_DISABLED) {
    await app.register(rateLimit, {
      max: 600,
      timeWindow: '1 minute',
      redis: app.get(RedisService).client,
      nameSpace: 'rl-global:',
    });
  }
  app.enableCors({
    origin: [config.WEB_ORIGIN],
    credentials: true,
    allowedHeaders: ['content-type', CSRF_HEADER, 'x-company-id'],
  });

  // CSRF-Schutz: Schreibende Anfragen brauchen einen eigenen Header. Fremde Webseiten können
  // diesen wegen CORS nicht setzen. Zusätzlich sind Cookies SameSite=Lax.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (req, reply) => {
      if (
        !SAFE.has(req.method) &&
        req.url.startsWith('/api/') &&
        req.headers[CSRF_HEADER] !== '1' &&
        // API-Schlüssel ohne Cookie: kein Browser-Kontext, daher kein CSRF-Risiko
        !(
          !req.headers.cookie &&
          typeof req.headers.authorization === 'string' &&
          req.headers.authorization.startsWith('Bearer fe_live_')
        )
      ) {
        await reply
          .status(403)
          .header('content-type', 'application/problem+json')
          .send({
            type: 'about:blank',
            title: 'CSRF_HEADER_MISSING',
            status: 403,
            code: 'CSRF_HEADER_MISSING',
            detail: `Header ${CSRF_HEADER} fehlt`,
          });
      }
    });

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('FangEvo Wawi Pro API')
      .setDescription(
        'REST-API von FangEvo Wawi Pro. Fehler im Format RFC 9457 (application/problem+json).',
      )
      .setVersion('1')
      .addCookieAuth('fe_session')
      .build(),
  );
  // Interaktive Doku-Oberfläche nur außerhalb der Produktion (kleinere Angriffsfläche);
  // die maschinenlesbare OpenAPI-Beschreibung ist immer verfügbar.
  SwaggerModule.setup('api/docs', app, doc, {
    jsonDocumentUrl: 'api/openapi.json',
    ui: !config.isProd,
  });

  app.enableShutdownHooks();
  return app;
}
