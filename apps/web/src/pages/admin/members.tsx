import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Spinner,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@fangevo/ui';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { formatDate } from '../../lib/format';
import {
  type Company,
  type Invitation,
  type Member,
  type PermissionInfo,
  type Role,
} from '../../lib/types';
import { useCan, useSession } from '../../lib/session';
import { AccessEditor, type AccessValue } from './access-editor';

export function MembersPage() {
  const s = useSession();
  const can = useCan();
  const qc = useQueryClient();
  const manage = can('users.manage') && s.account?.accessMode === 'full';
  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => http.get<Member[]>('/admin/members'),
  });
  const invitations = useQuery({
    queryKey: ['invitations'],
    queryFn: () => http.get<Invitation[]>('/admin/members/invitations'),
  });
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => http.get<Role[]>('/admin/roles'),
    enabled: can('roles.read'),
  });
  const companies = useQuery({
    queryKey: ['companies', false],
    queryFn: () => http.get<Company[]>('/admin/companies'),
    enabled: can('companies.read'),
  });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const roleName = (id: string) => roles.data?.find((r) => r.id === id)?.name ?? '…';

  const act = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      await qc.invalidateQueries();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Benutzer"
        description="Laden Sie Mitarbeiter ein und legen Sie fest, was sie sehen und tun dürfen."
        actions={
          manage && (
            <Button
              onClick={() => setInviteOpen(true)}
              disabled={roles.isPending || companies.isPending}
            >
              <UserPlus /> Einladen
            </Button>
          )
        }
      />
      {actionError && (
        <div className="mb-4">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      )}
      <Card>
        {members.isPending ? (
          <Spinner />
        ) : members.isError ? (
          <div className="p-4">
            <Alert tone="danger">{errorMessage(members.error)}</Alert>
          </div>
        ) : !members.data.length ? (
          <EmptyState icon={<Users />} title="Noch keine Benutzer" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Person</TH>
                <TH>Rollen</TH>
                <TH>Firmen</TH>
                <TH>Status</TH>
                {manage && <TH className="text-right">Aktionen</TH>}
              </tr>
            </THead>
            <TBody>
              {members.data.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{m.user.name}</p>
                      {m.isOwner && <Badge tone="primary">Inhaber</Badge>}
                      {m.user.mfaEnabled && (
                        <ShieldCheck
                          className="size-4 text-success"
                          aria-label="Zwei-Faktor aktiv"
                        />
                      )}
                    </div>
                    <p className="text-xs text-muted">{m.user.email}</p>
                  </TD>
                  <TD>
                    {m.isOwner ? (
                      <span className="text-muted">Alle Rechte</span>
                    ) : (
                      m.roleIds.map(roleName).join(', ') || '–'
                    )}
                    {m.permissions.length > 0 && (
                      <span className="text-muted"> +{m.permissions.length}</span>
                    )}
                  </TD>
                  <TD>{m.isOwner || m.allCompanies ? 'Alle' : `${m.companyIds.length}`}</TD>
                  <TD>
                    {m.status === 'ACTIVE' ? (
                      <Badge tone="success">Aktiv</Badge>
                    ) : (
                      <Badge tone="danger">Gesperrt</Badge>
                    )}
                  </TD>
                  {manage && (
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        {!m.isOwner && (
                          <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                            Rechte
                          </Button>
                        )}
                        {m.user.id !== s.user.id &&
                          (m.status === 'ACTIVE' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => act(() => http.post(`/admin/members/${m.id}/disable`))}
                            >
                              Sperren
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => act(() => http.post(`/admin/members/${m.id}/enable`))}
                            >
                              Entsperren
                            </Button>
                          ))}
                      </div>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {!!invitations.data?.length && (
        <Card className="mt-6">
          <CardHeader title="Offene Einladungen" />
          <Table>
            <TBody>
              {invitations.data.map((i) => (
                <TR key={i.id}>
                  <TD>
                    <Mail className="mr-2 inline size-4 text-muted" />
                    {i.email}
                  </TD>
                  <TD className="text-muted">gültig bis {formatDate(i.expiresAt)}</TD>
                  {manage && (
                    <TD className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => act(() => http.del(`/admin/members/invitations/${i.id}`))}
                      >
                        <X /> Widerrufen
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {inviteOpen && roles.data && companies.data && (
        <InviteDialog
          roles={roles.data ?? []}
          companies={companies.data ?? []}
          onClose={() => setInviteOpen(false)}
        />
      )}
      {editing && roles.data && companies.data && (
        <EditAccessDialog
          member={editing}
          roles={roles.data ?? []}
          companies={companies.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function InviteDialog({
  roles,
  companies,
  onClose,
}: {
  roles: Role[];
  companies: Company[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [access, setAccess] = useState<AccessValue>({
    roleIds: roles.filter((r) => r.name === 'Mitarbeiter').map((r) => r.id),
    permissions: [],
    allCompanies: false,
    companyIds: companies.slice(0, 1).map((c) => c.id),
  });
  const f = useSubmit(
    () =>
      http.post('/admin/members/invitations', {
        email,
        roleIds: access.roleIds,
        allCompanies: access.allCompanies,
        companyIds: access.companyIds,
      }),
    async () => {
      await qc.invalidateQueries();
      onClose();
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Person einladen"
      description="Die Person erhält eine E-Mail mit einem Link (7 Tage gültig)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button loading={f.pending} onClick={() => f.submit(undefined)}>
            Einladung senden
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <Field label="E-Mail-Adresse" error={f.fieldErrors.email}>
          {(p) => (
            <Input
              {...p}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          )}
        </Field>
        <AccessEditor value={access} onChange={setAccess} roles={roles} companies={companies} />
      </div>
    </Dialog>
  );
}

function EditAccessDialog({
  member,
  roles,
  companies,
  onClose,
}: {
  member: Member;
  roles: Role[];
  companies: Company[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ['permission-catalog'],
    queryFn: () => http.get<PermissionInfo[]>('/admin/roles/permissions'),
  });
  const [access, setAccess] = useState<AccessValue>({
    roleIds: member.roleIds,
    permissions: member.permissions,
    allCompanies: member.allCompanies,
    companyIds: member.companyIds,
  });
  const f = useSubmit(
    () => http.put(`/admin/members/${member.id}/access`, access),
    async () => {
      await qc.invalidateQueries();
      onClose();
    },
  );
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Rechte von ${member.user.name}`}
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
      <div className="space-y-4">
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <AccessEditor
          value={access}
          onChange={setAccess}
          roles={roles}
          companies={companies}
          catalog={catalog.data}
          showPermissions
        />
      </div>
    </Dialog>
  );
}
