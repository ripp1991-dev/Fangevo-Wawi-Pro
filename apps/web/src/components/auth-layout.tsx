import { type ReactNode } from 'react';
import { Logo } from './logo';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1fr_1.1fr]">
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Logo className="mb-10" />
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-sm text-muted">{footer}</div>}
        </div>
      </main>
      <aside
        className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-slate-900 lg:block"
        aria-hidden
      >
        <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:24px_24px]" />
        <div className="relative flex h-full flex-col justify-end p-14 text-white">
          <p className="max-w-md text-3xl font-semibold leading-tight">
            Eine Plattform. Unzählige Möglichkeiten. Angepasst an jedes Unternehmen.
          </p>
          <p className="mt-4 max-w-md text-indigo-100/80">
            Warenwirtschaft, Lager, Versand und Multichannel in einer modernen, anpassbaren
            Oberfläche.
          </p>
        </div>
      </aside>
    </div>
  );
}
