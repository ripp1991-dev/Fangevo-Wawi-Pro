import { useQueryClient } from '@tanstack/react-query';
import { Archive, Plus, RotateCcw, Star } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@fangevo/ui';
import { ApiError, errorMessage, http } from '../../lib/api';
import { categoryPaths, toInput, useMasterData, type MasterData } from '../../lib/master-data';
import { useSession } from '../../lib/session';

/** Firmeneinstellungen der aktiven Firma (Steuersätze, Kundengruppen, Kategorien, Lager, Nummernkreise). */
export function CompanySettingsPage() {
  const s = useSession();
  const md = useMasterData();
  const company =
    s.account?.companies.find(
      (c) => c.id === localStorage.getItem(`fe-company:${s.account?.id}`),
    ) ?? s.account?.companies[0];
  if (md.isPending) return <Spinner />;
  if (md.isError) return <Alert tone="danger">{errorMessage(md.error)}</Alert>;
  return (
    <>
      <PageHeader
        title="Firmeneinstellungen"
        description={`Gilt für die aktive Firma${company ? ` „${company.name}“` : ''}. Andere Firmen wählen Sie oben rechts.`}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <TaxRates md={md.data} />
        <CustomerGroups md={md.data} />
        <Warehouses md={md.data} />
        <Categories md={md.data} />
        <Sequences md={md.data} />
        <General md={md.data} />
        <DocumentSettings md={md.data} />
      </div>
    </>
  );
}

function useAct() {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['master-data'] });
      return true;
    } catch (e) {
      setErr(errorMessage(e));
      return false;
    }
  };
  return { err, run };
}

function Section({
  title,
  description,
  children,
  err,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  err: string | null;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="space-y-3">
        {err && <Alert tone="danger">{err}</Alert>}
        {children}
      </CardBody>
    </Card>
  );
}

function TaxRates({ md }: { md: MasterData }) {
  const { err, run } = useAct();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  return (
    <Section
      title="Steuersätze"
      description="Je Artikel wählbar. Der Prozentsatz ist nach dem Anlegen fest. Für neue Sätze einen neuen Eintrag anlegen."
      err={err}
    >
      <Table>
        <THead>
          <tr>
            <TH>Bezeichnung</TH>
            <TH>Satz</TH>
            <TH />
          </tr>
        </THead>
        <TBody>
          {md.taxRates.map((t) => (
            <TR key={t.id} className={t.archivedAt ? 'opacity-50' : ''}>
              <TD>
                {t.name} {t.isDefault && <Badge tone="primary">Standard</Badge>}{' '}
                {t.archivedAt && <Badge>Archiviert</Badge>}
              </TD>
              <TD>{toInput(t.rate)} %</TD>
              <TD className="text-right">
                {!t.isDefault && !t.archivedAt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${t.name} als Standard`}
                    onClick={() =>
                      run(() =>
                        http.put(`/company/tax-rates/${t.id}`, {
                          name: t.name,
                          rate: t.rate,
                          isDefault: true,
                        }),
                      )
                    }
                  >
                    <Star />
                  </Button>
                )}
                {!t.isDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t.archivedAt ? 'Wiederherstellen' : 'Archivieren'}
                    onClick={() => run(() => http.post(`/company/tax-rates/${t.id}/archive`))}
                  >
                    {t.archivedAt ? <RotateCcw /> : <Archive />}
                  </Button>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => http.post('/company/tax-rates', { name, rate })).then(
            (ok) => ok && (setName(''), setRate('')),
          );
        }}
      >
        <div className="min-w-40 flex-1">
          <Field label="Neuer Steuersatz">
            {(p) => (
              <Input
                {...p}
                placeholder="z. B. Landwirtschaft"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            )}
          </Field>
        </div>
        <div className="w-24">
          <Field label="%">
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                placeholder="10,7"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                required
              />
            )}
          </Field>
        </div>
        <Button type="submit" variant="secondary">
          <Plus /> Anlegen
        </Button>
      </form>
    </Section>
  );
}

function CustomerGroups({ md }: { md: MasterData }) {
  const { err, run } = useAct();
  const [v, setV] = useState({ name: '', priceDisplay: 'gross', discountPercent: '0' });
  return (
    <Section
      title="Kundengruppen"
      description="Steuert u. a., ob Preise brutto oder netto angezeigt werden, und einen Grundrabatt."
      err={err}
    >
      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH>Preise</TH>
            <TH>Rabatt</TH>
            <TH />
          </tr>
        </THead>
        <TBody>
          {md.customerGroups.map((g) => (
            <TR key={g.id}>
              <TD>
                {g.name} {g.isDefault && <Badge tone="primary">Standard</Badge>}
              </TD>
              <TD>{g.priceDisplay === 'gross' ? 'brutto' : 'netto'}</TD>
              <TD>{toInput(g.discountPercent)} %</TD>
              <TD className="text-right">
                {!g.isDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${g.name} als Standard`}
                    onClick={() =>
                      run(() =>
                        http.put(`/company/customer-groups/${g.id}`, {
                          name: g.name,
                          priceDisplay: g.priceDisplay,
                          discountPercent: g.discountPercent,
                          isDefault: true,
                        }),
                      )
                    }
                  >
                    <Star />
                  </Button>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => http.post('/company/customer-groups', v)).then(
            (ok) => ok && setV({ name: '', priceDisplay: 'gross', discountPercent: '0' }),
          );
        }}
      >
        <div className="min-w-40 flex-1">
          <Field label="Neue Kundengruppe">
            {(p) => (
              <Input
                {...p}
                value={v.name}
                onChange={(e) => setV({ ...v, name: e.target.value })}
                required
              />
            )}
          </Field>
        </div>
        <div className="w-28">
          <Field label="Preise">
            {(p) => (
              <Select
                {...p}
                value={v.priceDisplay}
                onChange={(e) => setV({ ...v, priceDisplay: e.target.value })}
              >
                <option value="gross">brutto</option>
                <option value="net">netto</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="w-24">
          <Field label="Rabatt %">
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={v.discountPercent}
                onChange={(e) => setV({ ...v, discountPercent: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Button type="submit" variant="secondary">
          <Plus /> Anlegen
        </Button>
      </form>
    </Section>
  );
}

function Warehouses({ md }: { md: MasterData }) {
  const { err, run } = useAct();
  const [v, setV] = useState({ code: '', name: '' });
  const [loc, setLoc] = useState<Record<string, string>>({});
  return (
    <Section title="Lager und Lagerplätze" err={err}>
      <ul className="space-y-3">
        {md.warehouses.map((w) => {
          const locs = md.locations.filter((l) => l.warehouseId === w.id);
          return (
            <li
              key={w.id}
              className={`rounded-lg border border-border p-3 ${w.archivedAt ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-2">
                <p className="flex-1 text-sm font-medium">
                  {w.code} · {w.name} {w.isDefault && <Badge tone="primary">Standard</Badge>}{' '}
                  {w.archivedAt && <Badge>Archiviert</Badge>}
                </p>
                {!w.isDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={w.archivedAt ? 'Lager wiederherstellen' : 'Lager archivieren'}
                    onClick={() => run(() => http.post(`/company/warehouses/${w.id}/archive`))}
                  >
                    {w.archivedAt ? <RotateCcw /> : <Archive />}
                  </Button>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                {locs.length
                  ? `Lagerplätze: ${locs.map((l) => l.code).join(', ')}`
                  : 'Keine Lagerplätze'}
              </p>
              {!w.archivedAt && (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() =>
                      http.post(`/company/warehouses/${w.id}/locations`, { code: loc[w.id] }),
                    ).then((ok) => ok && setLoc({ ...loc, [w.id]: '' }));
                  }}
                >
                  <Input
                    aria-label={`Neuer Lagerplatz in ${w.name}`}
                    placeholder="Neuer Lagerplatz, z. B. R1-F2"
                    value={loc[w.id] ?? ''}
                    onChange={(e) => setLoc({ ...loc, [w.id]: e.target.value })}
                    required
                  />
                  <Button type="submit" size="sm" variant="secondary">
                    <Plus />
                  </Button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => http.post('/company/warehouses', v)).then(
            (ok) => ok && setV({ code: '', name: '' }),
          );
        }}
      >
        <div className="w-24">
          <Field label="Kürzel">
            {(p) => (
              <Input
                {...p}
                value={v.code}
                onChange={(e) => setV({ ...v, code: e.target.value })}
                required
              />
            )}
          </Field>
        </div>
        <div className="min-w-40 flex-1">
          <Field label="Neues Lager">
            {(p) => (
              <Input
                {...p}
                value={v.name}
                onChange={(e) => setV({ ...v, name: e.target.value })}
                required
              />
            )}
          </Field>
        </div>
        <Button type="submit" variant="secondary">
          <Plus /> Anlegen
        </Button>
      </form>
    </Section>
  );
}

function Categories({ md }: { md: MasterData }) {
  const { err, run } = useAct();
  const [v, setV] = useState({ name: '', parentId: '' });
  const [manu, setManu] = useState('');
  const paths = categoryPaths(md.categories);
  const sorted = [...md.categories].sort((a, b) =>
    (paths.get(a.id) ?? '').localeCompare(paths.get(b.id) ?? ''),
  );
  return (
    <Section title="Kategorien und Hersteller" err={err}>
      <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
        {sorted.map((c) => (
          <li
            key={c.id}
            className={`flex items-center justify-between rounded-md px-2 py-1 hover:bg-surface-2 ${c.archivedAt ? 'opacity-50' : ''}`}
          >
            <span>{paths.get(c.id)}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={c.archivedAt ? 'Kategorie wiederherstellen' : 'Kategorie archivieren'}
              onClick={() => run(() => http.post(`/company/categories/${c.id}/archive`))}
            >
              {c.archivedAt ? <RotateCcw /> : <Archive />}
            </Button>
          </li>
        ))}
        {!sorted.length && <li className="text-muted">Noch keine Kategorien.</li>}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            http.post('/company/categories', { name: v.name, parentId: v.parentId || null }),
          ).then((ok) => ok && setV({ name: '', parentId: v.parentId }));
        }}
      >
        <div className="min-w-40 flex-1">
          <Field label="Neue Kategorie">
            {(p) => (
              <Input
                {...p}
                value={v.name}
                onChange={(e) => setV({ ...v, name: e.target.value })}
                required
              />
            )}
          </Field>
        </div>
        <div className="min-w-40 flex-1">
          <Field label="Unter">
            {(p) => (
              <Select
                {...p}
                value={v.parentId}
                onChange={(e) => setV({ ...v, parentId: e.target.value })}
              >
                <option value="">– oberste Ebene –</option>
                {sorted
                  .filter((c) => !c.archivedAt)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {paths.get(c.id)}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>
        <Button type="submit" variant="secondary">
          <Plus /> Anlegen
        </Button>
      </form>
      <div className="border-t border-border pt-3">
        <p className="mb-1 text-sm font-medium">Hersteller</p>
        <p className="mb-2 text-xs text-muted">
          {md.manufacturers.map((m) => m.name).join(', ') || 'Noch keine Hersteller.'}
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => http.post('/company/manufacturers', { name: manu })).then(
              (ok) => ok && setManu(''),
            );
          }}
        >
          <Input
            aria-label="Neuer Hersteller"
            placeholder="Neuer Hersteller"
            value={manu}
            onChange={(e) => setManu(e.target.value)}
            required
          />
          <Button type="submit" size="sm" variant="secondary">
            <Plus />
          </Button>
        </form>
      </div>
    </Section>
  );
}

function Sequences({ md }: { md: MasterData }) {
  const { err, run } = useAct();
  const [edit, setEdit] = useState<
    Record<string, { prefix: string; nextValue: string; padding: string }>
  >({});
  return (
    <Section
      title="Nummernkreise"
      description="Nummern werden lückenlos vergeben. Die nächste Nummer kann nur erhöht werden."
      err={err}
    >
      <Table>
        <THead>
          <tr>
            <TH>Nummernkreis</TH>
            <TH>Präfix</TH>
            <TH>Nächste Nr.</TH>
            <TH>Stellen</TH>
            <TH>Beispiel</TH>
            <TH />
          </tr>
        </THead>
        <TBody>
          {md.sequences.map((s) => {
            const e = edit[s.key] ?? {
              prefix: s.prefix,
              nextValue: String(s.nextValue),
              padding: String(s.padding),
            };
            const upd = (patch: Partial<typeof e>) =>
              setEdit({ ...edit, [s.key]: { ...e, ...patch } });
            return (
              <TR key={s.key}>
                <TD>{s.label}</TD>
                <TD>
                  <Input
                    aria-label={`Präfix ${s.label}`}
                    className="w-20"
                    value={e.prefix}
                    onChange={(x) => upd({ prefix: x.target.value })}
                  />
                </TD>
                <TD>
                  <Input
                    aria-label={`Nächste Nummer ${s.label}`}
                    className="w-28"
                    type="number"
                    min={s.nextValue}
                    value={e.nextValue}
                    onChange={(x) => upd({ nextValue: x.target.value })}
                  />
                </TD>
                <TD>
                  <Input
                    aria-label={`Stellen ${s.label}`}
                    className="w-16"
                    type="number"
                    min={1}
                    max={12}
                    value={e.padding}
                    onChange={(x) => upd({ padding: x.target.value })}
                  />
                </TD>
                <TD className="font-mono text-xs">
                  {e.prefix}
                  {String(e.nextValue).padStart(Number(e.padding) || 1, '0')}
                </TD>
                <TD>
                  {edit[s.key] && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        run(() =>
                          http.put(`/company/number-sequences/${s.key}`, {
                            prefix: e.prefix,
                            nextValue: Number(e.nextValue),
                            padding: Number(e.padding),
                          }),
                        ).then(
                          (ok) =>
                            ok &&
                            setEdit(
                              Object.fromEntries(Object.entries(edit).filter(([k]) => k !== s.key)),
                            ),
                        )
                      }
                    >
                      Speichern
                    </Button>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </Section>
  );
}

function General({ md }: { md: MasterData }) {
  const { err, run } = useAct();
  return (
    <Section title="Allgemein" err={err}>
      <Checkbox
        label="Minusbestand erlauben"
        description="Wenn aktiv, können Abgänge gebucht werden, auch wenn nicht genug Bestand vorhanden ist (z. B. Verkauf vor Wareneingang)."
        checked={!!md.settings?.allowNegativeStock}
        onChange={(e) =>
          run(() => http.put('/company/settings', { allowNegativeStock: e.target.checked }))
        }
      />
    </Section>
  );
}

const DOC_FIELDS = [
  {
    key: 'taxNumber',
    label: 'Steuernummer',
    hint: 'Steuernummer oder USt-IdNr. ist auf Rechnungen Pflicht',
  },
  { key: 'managingDirector', label: 'Geschäftsführung' },
  { key: 'registerCourt', label: 'Registergericht', hint: 'z. B. Amtsgericht Flensburg' },
  { key: 'registerNumber', label: 'Registernummer', hint: 'z. B. HRB 12345' },
  { key: 'bankName', label: 'Bank' },
  { key: 'iban', label: 'IBAN' },
  { key: 'bic', label: 'BIC' },
] as const;

/** Angaben, die auf Belegen (Rechnungen, Bestellungen …) gedruckt werden. */
function DocumentSettings({ md }: { md: MasterData }) {
  const qc = useQueryClient();
  const st = md.settings;
  const [v, setV] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      [...DOC_FIELDS.map((f) => f.key), 'documentFooter'].map((k) => [
        k,
        (st?.[k as keyof NonNullable<typeof st>] as string | null) ?? '',
      ]),
    ),
  );
  const [logo, setLogo] = useState<string | null>(st?.logoDataUrl ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErr(null);
    setFieldErr({});
    setSaved(false);
    try {
      await http.put('/company/settings', {
        allowNegativeStock: !!st?.allowNegativeStock,
        ...v,
        logoDataUrl: logo,
      });
      await qc.invalidateQueries({ queryKey: ['master-data'] });
      setSaved(true);
    } catch (e) {
      setErr(errorMessage(e));
      if (e instanceof ApiError) setFieldErr(e.fieldErrors);
    } finally {
      setBusy(false);
    }
  };
  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setErr('Bitte ein PNG- oder JPEG-Bild wählen.');
      return;
    }
    if (file.size > 200_000) {
      setErr('Das Logo darf höchstens 200 KB groß sein.');
      return;
    }
    const r = new FileReader();
    r.onload = () => setLogo(String(r.result));
    r.readAsDataURL(file);
  };
  return (
    <Section
      title="Angaben auf Belegen"
      description="Erscheinen in Kopf und Fußzeile von Rechnungen und anderen Belegen. Firmenname, Anschrift und USt-IdNr. pflegen Sie unter Administration › Firmen."
      err={err}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {DOC_FIELDS.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            hint={'hint' in f ? f.hint : undefined}
            error={fieldErr[f.key]}
          >
            {(p) => (
              <Input
                {...p}
                value={v[f.key] ?? ''}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              />
            )}
          </Field>
        ))}
        <div className="sm:col-span-2">
          <Field label="Zusatztext in der Fußzeile" error={fieldErr.documentFooter}>
            {(p) => (
              <Input
                {...p}
                value={v.documentFooter ?? ''}
                onChange={(e) => setV({ ...v, documentFooter: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <p className="text-sm font-medium">Logo (PNG oder JPEG, max. 200 KB)</p>
          {logo && (
            <img
              src={logo}
              alt="Logo"
              className="max-h-16 rounded border border-border bg-white p-1"
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept="image/png,image/jpeg"
              aria-label="Logo auswählen"
              className="text-sm"
              onChange={(e) => pickLogo(e.target.files?.[0])}
            />
            {logo && (
              <Button size="sm" variant="ghost" onClick={() => setLogo(null)}>
                Logo entfernen
              </Button>
            )}
          </div>
          {fieldErr.logoDataUrl && <p className="text-sm text-danger">{fieldErr.logoDataUrl}</p>}
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button loading={busy} onClick={save}>
          Speichern
        </Button>
        {saved && <span className="text-sm text-success">Gespeichert</span>}
      </div>
    </Section>
  );
}
