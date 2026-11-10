import { cn } from '@fangevo/ui';

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; hidden?: boolean }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="-mt-1 mb-4 flex flex-wrap gap-1 border-b border-border" role="tablist">
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={value === t.id}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
              value === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-fg',
            )}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
    </div>
  );
}
