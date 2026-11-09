import { z } from 'zod';
import { ALL_PERMISSIONS } from '../permissions';
import { emailSchema } from './auth';

const permissionEnum = z.enum(ALL_PERMISSIONS as [string, ...string[]]);

export const companyInputSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(160),
  legalName: z.string().trim().max(200).optional().nullable(),
  vatId: z.string().trim().max(32).optional().nullable(),
  street: z.string().trim().max(200).optional().nullable(),
  postalCode: z.string().trim().max(20).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  country: z.string().trim().length(2, 'Ländercode mit 2 Buchstaben, z. B. DE').toUpperCase().default('DE'),
  email: z.union([emailSchema, z.literal('')]).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
});
export type CompanyInput = z.infer<typeof companyInputSchema>;

export const roleInputSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(80),
  description: z.string().trim().max(300).optional().nullable(),
  permissions: z.array(permissionEnum).max(500),
});
export type RoleInput = z.infer<typeof roleInputSchema>;

export const inviteUserSchema = z.object({
  email: emailSchema,
  roleIds: z.array(z.uuid()).max(50).default([]),
  allCompanies: z.boolean().default(false),
  companyIds: z.array(z.uuid()).max(500).default([]),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateMemberAccessSchema = z.object({
  roleIds: z.array(z.uuid()).max(50),
  permissions: z.array(permissionEnum).max(500),
  allCompanies: z.boolean(),
  companyIds: z.array(z.uuid()).max(500),
});
export type UpdateMemberAccessInput = z.infer<typeof updateMemberAccessSchema>;

export const auditQuerySchema = z.object({
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().max(100).optional(),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
