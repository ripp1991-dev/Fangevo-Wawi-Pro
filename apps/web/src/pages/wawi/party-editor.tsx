import { Plus, Trash2 } from 'lucide-react';
import { Button, Checkbox, Input, Select } from '@fangevo/ui';

export interface AddressValue {
  kind: 'billing' | 'shipping';
  isDefault: boolean;
  name: string;
  name2: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
}
export interface ContactValue {
  name: string;
  role: string;
  email: string;
  phone: string;
}

export const toAddressValue = (a: Partial<Record<keyof AddressValue, unknown>>): AddressValue => ({
  kind: (a.kind as AddressValue['kind']) ?? 'billing',
  isDefault: !!a.isDefault,
  name: String(a.name ?? ''),
  name2: String(a.name2 ?? ''),
  street: String(a.street ?? ''),
  postalCode: String(a.postalCode ?? ''),
  city: String(a.city ?? ''),
  country: String(a.country ?? 'DE'),
});
export const toContactValue = (c: Partial<Record<keyof ContactValue, unknown>>): ContactValue => ({
  name: String(c.name ?? ''),
  role: String(c.role ?? ''),
  email: String(c.email ?? ''),
  phone: String(c.phone ?? ''),
});

export function AddressesEditor({
  value,
  onChange,
  error,
}: {
  value: AddressValue[];
  onChange: (v: AddressValue[]) => void;
  error?: string;
}) {
  const upd = (i: number, patch: Partial<AddressValue>) =>
    onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div className="space-y-3">
      {value.map((a, i) => (
        <div key={i} className="rounded-lg border border-border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <Select
              aria-label="Adressart"
              className="w-44"
              value={a.kind}
              onChange={(e) => upd(i, { kind: e.target.value as AddressValue['kind'] })}
            >
              <option value="billing">Rechnungsadresse</option>
              <option value="shipping">Lieferadresse</option>
            </Select>
            <Checkbox
              label="Standard"
              checked={a.isDefault}
              onChange={(e) =>
                onChange(
                  value.map((x, j) =>
                    j === i
                      ? { ...x, isDefault: e.target.checked }
                      : x.kind === a.kind && e.target.checked
                        ? { ...x, isDefault: false }
                        : x,
                  ),
                )
              }
            />
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Adresse entfernen"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-6">
            <Input
              aria-label="Name"
              placeholder="Name / Firma"
              className="sm:col-span-3"
              value={a.name}
              onChange={(e) => upd(i, { name: e.target.value })}
            />
            <Input
              aria-label="Zusatz"
              placeholder="Zusatz"
              className="sm:col-span-3"
              value={a.name2}
              onChange={(e) => upd(i, { name2: e.target.value })}
            />
            <Input
              aria-label="Straße"
              placeholder="Straße und Hausnummer"
              className="sm:col-span-6"
              value={a.street}
              onChange={(e) => upd(i, { street: e.target.value })}
            />
            <Input
              aria-label="PLZ"
              placeholder="PLZ"
              className="sm:col-span-1"
              value={a.postalCode}
              onChange={(e) => upd(i, { postalCode: e.target.value })}
            />
            <Input
              aria-label="Ort"
              placeholder="Ort"
              className="sm:col-span-4"
              value={a.city}
              onChange={(e) => upd(i, { city: e.target.value })}
            />
            <Input
              aria-label="Land"
              placeholder="DE"
              className="sm:col-span-1"
              maxLength={2}
              value={a.country}
              onChange={(e) => upd(i, { country: e.target.value.toUpperCase() })}
            />
          </div>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          onChange([
            ...value,
            toAddressValue({
              kind: value.some((a) => a.kind === 'billing') ? 'shipping' : 'billing',
              isDefault: !value.length,
            }),
          ])
        }
      >
        <Plus /> Adresse hinzufügen
      </Button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export function ContactsEditor({
  value,
  onChange,
}: {
  value: ContactValue[];
  onChange: (v: ContactValue[]) => void;
}) {
  const upd = (i: number, patch: Partial<ContactValue>) =>
    onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-2">
      {value.map((c, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr_1fr_auto]">
          <Input
            aria-label="Name"
            placeholder="Name"
            value={c.name}
            onChange={(e) => upd(i, { name: e.target.value })}
          />
          <Input
            aria-label="Funktion"
            placeholder="Funktion"
            value={c.role}
            onChange={(e) => upd(i, { role: e.target.value })}
          />
          <Input
            aria-label="E-Mail"
            placeholder="E-Mail"
            type="email"
            value={c.email}
            onChange={(e) => upd(i, { email: e.target.value })}
          />
          <Input
            aria-label="Telefon"
            placeholder="Telefon"
            value={c.phone}
            onChange={(e) => upd(i, { phone: e.target.value })}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Ansprechpartner entfernen"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onChange([...value, toContactValue({})])}
      >
        <Plus /> Ansprechpartner hinzufügen
      </Button>
    </div>
  );
}
