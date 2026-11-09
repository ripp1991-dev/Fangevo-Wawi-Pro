import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { type Permission } from '@fangevo/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Dialog,
  Field,
  Input,
  PageHeader,
  Spinner,
} from '@fangevo/ui';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { type PermissionInfo, type Role } from '../../lib/types';
import { useCan, useSession } from '../../lib/session';

export function RolesPage() {
  const can = useCan();
  const s = useSession();
  const qc = useQueryClient();
  const manage = can('roles.manage') && s.account?.accessMode === 'full';
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => http.get<Role[]>('/admin/roles') });
  const catalog = useQuery({
    queryKey: ['permission-catalog'],
    queryFn: () => http.get<PermissionInfo[]>('/admin/roles/permissions'),
  });
  const [edit, setEdit] = useState<Role | 'new' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const label = (p: Permission) => catalog.data?.find((c) => c.key === p)?.label ?? p;

  return (
    <>
      <PageHeader
        title="Rollen & Rechte"
        description="Rollen bündeln Rechte. Inhaber haben immer alle Rechte."
        actions={
          manage && (
            <Button onClick={() => setEdit('new')}>
              <Plus /> Rolle anlegen
            </Button>
          )
        }
      />
      {err && (
        <div className="mb-4">
          <Alert tone="danger">{err}</Alert>
        </div>
      )}
      {roles.isPending ? (
        <Spinner />
      ) : roles.isError ? (
        <Alert tone="danger">{errorMessage(roles.error)}</Alert>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {roles.data.map((r) => (
            <Card key={r.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {r.name}
                    {r.system && (
                      <Badge>
                        <Lock className="size-3" /> System
                      </Badge>
                    )}
                  </span>
                }
                description={`${r.description ?? ''}${r.description ? ' · ' : ''}${r.memberCount} Personen`}
                actions={
                  manage &&
                  !r.system && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEdit(r)}
                        aria-label="Bearbeiten"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Löschen"
                        onClick={async () => {
                          if (!confirm(`Rolle "${r.name}" wirklich löschen?`)) return;
                          setErr(null);
                          try {
                            await http.del(`/admin/roles/${r.id}`);
                            await qc.invalidateQueries();
                          } catch (e) {
                            setErr(errorMessage(e));
                          }
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )
                }
              />
              <CardBody>
                <div className="flex flex-wrap gap-1.5">
                  {r.permissions.length ? (
                    r.permissions.map((p) => <Badge key={p}>{label(p)}</Badge>)
                  ) : (
                    <span className="text-sm text-muted">Keine Rechte</span>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      {edit && catalog.data && (
        <RoleDialog
          role={edit === 'new' ? null : edit}
          catalog={catalog.data}
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}

function RoleDialog({
  role,
  catalog,
  onClose,
}: {
  role: Role | null;
  catalog: PermissionInfo[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<Permission[]>(role?.permissions ?? []);
  const f = useSubmit(
    () =>
      role
        ? http.put(`/admin/roles/${role.id}`, { name, description, permissions: perms })
        : http.post('/admin/roles', { name, description, permissions: perms }),
    async () => {
      await qc.invalidateQueries();
      onClose();
    },
  );
  const modules = [...new Set(catalog.map((c) => c.moduleName))];
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={role ? 'Rolle bearbeiten' : 'Rolle anlegen'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button loading={f.pending} onClick={() => f.submit(undefined)}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <Field label="Name" error={f.fieldErrors.name}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
        </Field>
        <Field label="Beschreibung">
          {(p) => (
            <Input {...p} value={description} onChange={(e) => setDescription(e.target.value)} />
          )}
        </Field>
        {modules.map((m) => (
          <fieldset key={m} className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">{m}</legend>
            {catalog
              .filter((c) => c.moduleName === m)
              .map((c) => (
                <Checkbox
                  key={c.key}
                  label={c.label}
                  description={c.key}
                  checked={perms.includes(c.key)}
                  onChange={(e) =>
                    setPerms(
                      e.target.checked ? [...perms, c.key] : perms.filter((x) => x !== c.key),
                    )
                  }
                />
              ))}
          </fieldset>
        ))}
      </div>
    </Dialog>
  );
}
