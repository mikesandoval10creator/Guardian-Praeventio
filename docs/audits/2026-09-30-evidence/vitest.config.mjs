import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
// Optional checkout override is useful when archiving probes in a linked worktree.
const root = process.env.GUARDIAN_AUDIT_SOURCE_ROOT || path.resolve(here, '../../..');
const deps = root;
const mod = (name) => path.resolve(deps, 'node_modules', name).replaceAll('\\', '/');
export default {
  root,
  esbuild: { jsx: 'automatic' },
  resolve: { alias: [
    { find: /^@guardian-audit\/(.*)$/, replacement: root.replaceAll("\\", "/") + "/$1" },
    { find: /^react$/, replacement: mod('react/index.js') },
    { find: /^react\/jsx-runtime$/, replacement: mod('react/jsx-runtime.js') },
    { find: /^react\/jsx-dev-runtime$/, replacement: mod('react/jsx-dev-runtime.js') },
    { find: /^react-dom$/, replacement: mod('react-dom/index.js') },
    { find: /^react-dom\/client$/, replacement: mod('react-dom/client.js') },
    { find: /^react-dom\/test-utils$/, replacement: mod('react-dom/test-utils.js') },
    { find: /^react-router-dom$/, replacement: mod('react-router-dom/dist/index.mjs') },
    { find: /^react-i18next$/, replacement: mod('react-i18next/dist/es/index.js') },
    { find: /^@testing-library\/react$/, replacement: mod('@testing-library/react/dist/index.js') },
  ] },
  test: {
    environment: 'jsdom',
    include: [path.join(here, '*.test.tsx').replaceAll('\\', '/')],
    setupFiles: [path.join(root, 'src/test/setup.ts'), path.join(root, 'src/test/setupFirebaseAdminMocks.ts')],
    globals: true, pool: 'forks', fileParallelism: false, testTimeout: 30000, teardownTimeout: 10000,
  },
};
