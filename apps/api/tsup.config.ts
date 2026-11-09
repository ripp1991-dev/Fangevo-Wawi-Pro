import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/worker.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Workspace-Pakete werden mitgebündelt, externe Abhängigkeiten bleiben in node_modules.
  noExternal: [/^@fangevo\//],
  // Prisma lädt seine Engine zur Laufzeit und darf nicht gebündelt werden.
  external: ['@prisma/client', '.prisma/client'],
});
