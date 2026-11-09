import { type LoggerService } from '@nestjs/common';

/**
 * Letzte Absicherung für API und Worker (Phase 8):
 * - nicht abgefangene Promise-Fehler werden protokolliert, der Prozess läuft weiter
 * - nicht abgefangene Ausnahmen werden protokolliert, danach beendet sich der Prozess,
 *   damit der Prozessmanager (Docker/systemd/Kubernetes) ihn sauber neu startet
 */
export function installProcessGuards(logger: LoggerService, name: string): void {
  process.on('unhandledRejection', (reason) => {
    logger.error(
      `Unbehandelter Promise-Fehler: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
      name,
    );
  });
  process.on('uncaughtException', (err) => {
    logger.error(`Unbehandelte Ausnahme, Prozess wird beendet: ${err.stack ?? err.message}`, name);
    setTimeout(() => process.exit(1), 200).unref();
  });
}
