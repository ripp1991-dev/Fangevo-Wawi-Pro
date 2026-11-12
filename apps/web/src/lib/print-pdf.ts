import { ApiError, getActiveCompany } from './api';

/**
 * PDF aus der API laden und direkt drucken (unsichtbarer Rahmen).
 * Ohne Druckdialog nur, wenn Chrome mit `--kiosk-printing` gestartet wurde; sonst erscheint der
 * normale Druckdialog. Gedruckt wird auf dem Standarddrucker des Geräts.
 */
export async function printPdf(path: string): Promise<void> {
  const companyId = getActiveCompany();
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: companyId ? { 'x-company-id': companyId } : {},
  });
  if (!res.ok) {
    const p = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new ApiError(res.status, 'INTERNAL_ERROR', p.detail ?? 'PDF konnte nicht geladen werden');
  }
  const url = URL.createObjectURL(await res.blob());
  await new Promise<void>((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.src = url;
    frame.onload = () => {
      // Kurz warten, bis der PDF-Betrachter bereit ist
      window.setTimeout(() => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          resolve();
        } catch (e) {
          reject(e instanceof Error ? e : new Error('Drucken nicht möglich'));
        }
        // Rahmen erst später entfernen, sonst bricht der Druck ab
        window.setTimeout(() => {
          frame.remove();
          URL.revokeObjectURL(url);
        }, 60_000);
      }, 300);
    };
    document.body.appendChild(frame);
  });
}
