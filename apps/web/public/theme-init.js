/* global document, matchMedia */
// Farbschema vor dem ersten Rendern setzen (kein Aufblitzen). Eigene Datei statt Inline-Skript,
// damit die Content-Security-Policy keine Inline-Skripte erlauben muss.
try {
  var t = localStorage.getItem('fe-theme');
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches))
    document.documentElement.classList.add('dark');
} catch {
  // Speicher nicht verfügbar (z. B. privater Modus): Standardfarben
}
