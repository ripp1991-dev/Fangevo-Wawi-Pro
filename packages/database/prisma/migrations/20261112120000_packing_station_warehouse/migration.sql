-- Packplatz gehört zu einem Lager (Touch-Packtisch: Lager → Packplatz).
-- Nicht-destruktiv: neue, optionale Spalte; bestehende Packplätze bleiben unverändert (null = alle Lager).
-- RLS der Tabelle bleibt unverändert (account_id/company_id, siehe phase4_logistics).

-- AlterTable
ALTER TABLE "packing_stations" ADD COLUMN "warehouse_id" UUID;

-- CreateIndex
CREATE INDEX "packing_stations_company_id_warehouse_id_idx" ON "packing_stations"("company_id", "warehouse_id");
