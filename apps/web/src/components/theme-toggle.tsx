import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@fangevo/ui';

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? 'Helles Design' : 'Dunkles Design'}
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle('dark', next);
        try {
          localStorage.setItem('fe-theme', next ? 'dark' : 'light');
        } catch {
          /* ignorieren */
        }
        setDark(next);
      }}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
