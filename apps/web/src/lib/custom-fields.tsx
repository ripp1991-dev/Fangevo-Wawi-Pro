import { useQuery } from '@tanstack/react-query';
import { type CustomFieldEntity } from '@fangevo/shared';
import { Checkbox, Field, Input, Select } from '@fangevo/ui';
import { type Column } from '../components/table/types';
import { http } from './api';

export interface CustomFieldDef {
  id: string;
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect' | 'reference';
  options: { value: string; label: string }[] | null;
  required: boolean;
  position: number;
  referenceEntity: 'company' | 'member' | null;
  archivedAt: string | null;
}

export function useCustomFields(entityType: CustomFieldEntity) {
  return useQuery({
    queryKey: ['custom-fields', entityType],
    queryFn: () => http.get<CustomFieldDef[]>(`/custom-fields?entityType=${entityType}`),
  });
}

/** Tabellenspalten für eigene Felder (Präfix "cf."). Verweise zeigen den Namen, wenn bekannt. */
export function customFieldColumns<T extends { customFields?: unknown }>(
  defs: CustomFieldDef[],
  refLabel?: (entity: string, id: string) => string | undefined,
): Column<T>[] {
  const kind = {
    text: 'string',
    number: 'number',
    date: 'date',
    boolean: 'boolean',
    select: 'enum',
    multiselect: 'enum',
    reference: 'string',
  } as const;
  return defs.map((d) => ({
    id: `cf.${d.key}`,
    header: d.label,
    kind: kind[d.type],
    options: d.options ?? undefined,
    defaultHidden: false,
    sortable: false,
    groupable: d.type === 'select' || d.type === 'boolean',
    value: (r: T) => ((r.customFields ?? {}) as Record<string, unknown>)[d.key],
    text:
      d.type === 'reference'
        ? (r: T) => {
            const v = ((r.customFields ?? {}) as Record<string, unknown>)[d.key];
            return v ? (refLabel?.(d.referenceEntity ?? '', String(v)) ?? String(v)) : '';
          }
        : d.type === 'boolean'
          ? (r: T) => {
              const v = ((r.customFields ?? {}) as Record<string, unknown>)[d.key];
              return v === undefined || v === null ? '' : v ? 'Ja' : 'Nein';
            }
          : undefined,
  }));
}

/** Eingabefelder für eigene Felder in Formularen. */
export function CustomFieldInputs({
  defs,
  values,
  onChange,
  errors,
  references,
}: {
  defs: CustomFieldDef[];
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  errors: Record<string, string>;
  references: Record<string, { id: string; name: string }[]>;
}) {
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  return (
    <>
      {defs.map((d) => {
        const err = errors[`customFields.${d.key}`];
        const v = values[d.key];
        const label = d.required ? `${d.label} *` : d.label;
        if (d.type === 'boolean')
          return (
            <div key={d.key} className="flex items-end pb-2">
              <Checkbox
                label={d.label}
                checked={v === true}
                onChange={(e) => set(d.key, e.target.checked)}
              />
            </div>
          );
        if (d.type === 'multiselect')
          return (
            <fieldset key={d.key} className="space-y-1.5 sm:col-span-2">
              <legend className="text-sm font-medium">{label}</legend>
              <div className="flex flex-wrap gap-4">
                {d.options?.map((o) => {
                  const arr = Array.isArray(v) ? (v as string[]) : [];
                  return (
                    <Checkbox
                      key={o.value}
                      label={o.label}
                      checked={arr.includes(o.value)}
                      onChange={(e) =>
                        set(
                          d.key,
                          e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value),
                        )
                      }
                    />
                  );
                })}
              </div>
              {err && <p className="text-sm text-danger">{err}</p>}
            </fieldset>
          );
        return (
          <Field key={d.key} label={label} error={err}>
            {(p) =>
              d.type === 'select' || d.type === 'reference' ? (
                <Select
                  {...p}
                  value={String(v ?? '')}
                  onChange={(e) => set(d.key, e.target.value || null)}
                >
                  <option value="">– keine Angabe –</option>
                  {(d.type === 'select'
                    ? (d.options ?? []).map((o) => ({ id: o.value, name: o.label }))
                    : (references[d.referenceEntity ?? ''] ?? [])
                  ).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  {...p}
                  type={d.type === 'number' ? 'text' : d.type === 'date' ? 'date' : 'text'}
                  inputMode={d.type === 'number' ? 'decimal' : undefined}
                  value={v === undefined || v === null ? '' : String(v)}
                  onChange={(e) => set(d.key, e.target.value)}
                />
              )
            }
          </Field>
        );
      })}
    </>
  );
}
