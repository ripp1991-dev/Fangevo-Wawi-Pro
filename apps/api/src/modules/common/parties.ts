import { uuidv7, type Tx } from '@fangevo/database';
import { type z } from 'zod';
import { type addressInputSchema, type contactInputSchema } from '@fangevo/shared';
import { type CompanyContext } from './company-db';

type AddressIn = z.infer<typeof addressInputSchema>;
type ContactIn = z.infer<typeof contactInputSchema>;

/**
 * Adressen und Ansprechpartner von Kunden/Lieferanten vollständig ersetzen.
 * Je Art (Rechnung/Lieferung) gibt es höchstens eine Standardadresse; fehlt sie, wird die erste Standard.
 */
export async function replacePartyDetails(
  tx: Tx,
  c: CompanyContext,
  ownerType: 'customer' | 'supplier',
  ownerId: string,
  addresses: AddressIn[],
  contacts: ContactIn[],
): Promise<void> {
  const base = { accountId: c.account.id, companyId: c.companyId, ownerType, ownerId };
  await tx.address.deleteMany({ where: { ownerType, ownerId } });
  await tx.contact.deleteMany({ where: { ownerType, ownerId } });
  const normalized = (['billing', 'shipping'] as const).flatMap((kind) => {
    const list = addresses.filter((a) => a.kind === kind);
    const defIdx = Math.max(
      0,
      list.findIndex((a) => a.isDefault),
    );
    return list.map((a, i) => ({ ...a, isDefault: i === defIdx }));
  });
  if (normalized.length) {
    await tx.address.createMany({
      data: normalized.map((a) => ({
        ...base,
        id: uuidv7(),
        kind: a.kind,
        isDefault: a.isDefault,
        name: a.name,
        name2: a.name2,
        street: a.street,
        postalCode: a.postalCode,
        city: a.city,
        country: a.country,
      })),
    });
  }
  if (contacts.length) {
    await tx.contact.createMany({
      data: contacts.map((p) => ({
        ...base,
        id: uuidv7(),
        name: p.name,
        role: p.role,
        email: p.email,
        phone: p.phone,
      })),
    });
  }
}

export async function loadPartyDetails(
  tx: Tx,
  ownerType: 'customer' | 'supplier',
  ownerId: string,
) {
  const [addresses, contacts] = await Promise.all([
    tx.address.findMany({
      where: { ownerType, ownerId },
      orderBy: [{ kind: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
    }),
    tx.contact.findMany({ where: { ownerType, ownerId }, orderBy: { createdAt: 'asc' } }),
  ]);
  return { addresses, contacts };
}
