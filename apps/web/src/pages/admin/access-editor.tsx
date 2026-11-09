import { type Permission } from '@fangevo/shared';
import { Checkbox } from '@fangevo/ui';
import { type PermissionInfo, type Role } from '../../lib/types';

export interface AccessValue {
  roleIds: string[];
  permissions: Permission[];
  allCompanies: boolean;
  companyIds: string[];
}

function toggle<T>(list: T[], v: T, on: boolean): T[] {
  return on ? [...new Set([...list, v])] : list.filter((x) => x !== v);
}

/** Auswahl von Rollen, Einzelrechten und Firmenzugriff (für Einladung und Bearbeitung). */
export function AccessEditor({
  value,
  onChange,
  roles,
  companies,
  catalog,
  showPermissions,
}: {
  value: AccessValue;
  onChange: (v: AccessValue) => void;
  roles: Role[];
  companies: { id: string; name: string }[];
  catalog?: PermissionInfo[];
  showPermissions?: boolean;
}) {
  return (
    <div className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Rollen</legend>
        {roles.map((r) => (
          <Checkbox
            key={r.id}
            label={r.name}
            description={r.description ?? `${r.permissions.length} Rechte`}
            checked={value.roleIds.includes(r.id)}
            onChange={(e) =>
              onChange({ ...value, roleIds: toggle(value.roleIds, r.id, e.target.checked) })
            }
          />
        ))}
      </fieldset>

      {showPermissions && catalog && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">Zusätzliche Einzelrechte</legend>
          <p className="mb-2 text-xs text-muted">Zusätzlich zu den Rechten aus den Rollen.</p>
          {catalog.map((p) => (
            <Checkbox
              key={p.key}
              label={p.label}
              description={`${p.moduleName} · ${p.key}`}
              checked={value.permissions.includes(p.key)}
              onChange={(e) =>
                onChange({
                  ...value,
                  permissions: toggle(value.permissions, p.key, e.target.checked),
                })
              }
            />
          ))}
        </fieldset>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Firmenzugriff</legend>
        <Checkbox
          label="Alle Firmen"
          description="Auch Firmen, die später angelegt werden."
          checked={value.allCompanies}
          onChange={(e) => onChange({ ...value, allCompanies: e.target.checked })}
        />
        {!value.allCompanies && (
          <div className="ml-7 space-y-2">
            {companies.map((c) => (
              <Checkbox
                key={c.id}
                label={c.name}
                checked={value.companyIds.includes(c.id)}
                onChange={(e) =>
                  onChange({
                    ...value,
                    companyIds: toggle(value.companyIds, c.id, e.target.checked),
                  })
                }
              />
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}
