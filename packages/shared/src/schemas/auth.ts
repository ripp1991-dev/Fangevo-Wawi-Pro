import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('Ungültige E-Mail-Adresse'));

/** Mindestens 12 Zeichen (BSI-Empfehlung für Passwörter ohne Komplexitätsregeln). */
export const passwordSchema = z
  .string()
  .min(12, 'Das Passwort muss mindestens 12 Zeichen lang sein')
  .max(200, 'Das Passwort ist zu lang');

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(120),
  email: emailSchema,
  password: passwordSchema,
  accountName: z.string().trim().min(1, 'Firmenname fehlt').max(160),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaVerifySchema = z.object({
  code: z.string().trim().min(6).max(32),
});

export const mfaEnableSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Bitte den 6-stelligen Code eingeben'),
});

export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(200),
});

export const tokenSchema = z.object({ token: z.string().min(10).max(500) });

export const requestPasswordResetSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(500),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const switchAccountSchema = z.object({ accountId: z.uuid() });

export const acceptInvitationSchema = z.object({
  token: z.string().min(10).max(500),
  name: z.string().trim().min(1).max(120).optional(),
  password: passwordSchema.optional(),
});
