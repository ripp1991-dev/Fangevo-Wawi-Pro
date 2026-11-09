import { type Permission } from '@fangevo/shared';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  mfaEnabled: boolean;
}

export interface SessionData {
  user: SessionUser;
  mfaPending: boolean;
  accounts?: { id: string; name: string; isOwner: boolean }[];
  account?: {
    id: string;
    name: string;
    isOwner: boolean;
    permissions: Permission[];
    accessMode: 'full' | 'read_only' | 'none';
    license: {
      plan: string;
      status: string;
      trialEndsAt: string | null;
      modules: { key: string; name: string; available: boolean }[];
    };
    companies: { id: string; name: string }[];
  } | null;
}

export interface Company {
  id: string;
  name: string;
  legalName: string | null;
  vatId: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  archivedAt: string | null;
  version: number;
}

export interface Member {
  id: string;
  user: { id: string; email: string; name: string; mfaEnabled: boolean };
  isOwner: boolean;
  status: 'ACTIVE' | 'DISABLED';
  allCompanies: boolean;
  roleIds: string[];
  permissions: Permission[];
  companyIds: string[];
  createdAt: string;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  system: boolean;
  permissions: Permission[];
  memberCount: number;
}

export interface PermissionInfo {
  key: Permission;
  label: string;
  module: string;
  moduleName: string;
}

export interface Invitation {
  id: string;
  email: string;
  roleIds: string[];
  allCompanies: boolean;
  companyIds: string[];
  expiresAt: string;
  createdAt: string;
}
