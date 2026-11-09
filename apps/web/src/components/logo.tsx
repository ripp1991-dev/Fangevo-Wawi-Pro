import { cn } from '@fangevo/ui';

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-fg shadow-sm">
        F
      </div>
      {!compact && (
        <div className="leading-none">
          <span className="font-semibold tracking-tight">FangEvo</span>
          <span className="ml-1 text-sm font-medium text-muted">Wawi Pro</span>
        </div>
      )}
    </div>
  );
}
