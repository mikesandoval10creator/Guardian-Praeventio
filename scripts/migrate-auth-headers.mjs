// §2.20 migration script (2026-05-21).
//
// Migra el pattern boilerplate `authedFetch` de 95+ hooks al helper
// unificado `apiAuthHeaders()`. El pattern repetido:
//
//   async function authedFetch(path, init) {
//     const user = auth.currentUser;
//     const token = user ? await user.getIdToken() : null;
//     return fetch(path, {
//       ...init,
//       headers: {
//         'Content-Type': 'application/json',
//         ...(init.headers ?? {}),
//         ...(token ? { Authorization: `Bearer ${token}` } : {}),
//       },
//     });
//   }
//
// Se convierte a:
//
//   async function authedFetch(path, init) {
//     return fetch(path, {
//       ...init,
//       headers: {
//         'Content-Type': 'application/json',
//         ...(init.headers ?? {}),
//         ...(await apiAuthHeaders()),
//       },
//     });
//   }
//
// + import { apiAuthHeaders } from '../lib/apiAuth';
//
// Solo migra files cuyo `authedFetch` matchea el pattern EXACTO. Si
// alguno tiene custom logic, se loguea como skipped y se migra a mano.
//
// Uso: node scripts/migrate-auth-headers.mjs [--dry-run]

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const ROOT = process.cwd();
const HOOKS_DIR = join(ROOT, 'src', 'hooks');
const DRY_RUN = process.argv.includes('--dry-run');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(...walk(p));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.d.ts')
    ) {
      out.push(p);
    }
  }
  return out;
}

// Pattern matcher — busca el bloque exacto.
// Tolerante a variaciones de whitespace + comentarios entre líneas.
const AUTHED_FETCH_RE =
  /async function authedFetch\(\s*([\s\S]*?)\):\s*Promise<Response>\s*\{\s*const user = auth\.currentUser;\s*const token = user \? await user\.getIdToken\(\) : null;\s*return fetch\(path, \{\s*\.\.\.init,\s*headers: \{\s*'Content-Type': 'application\/json',\s*\.\.\.\(init\.headers \?\? \{\}\),\s*\.\.\.\(token \? \{ Authorization: `Bearer \$\{token\}` \} : \{\}\),\s*\},\s*\}\);\s*\}/m;

const REPLACEMENT_BODY = `async function authedFetch(
  $1
): Promise<Response> {
  // §2.20 migration (2026-05-21) — usa apiAuthHeaders() unificado:
  // prefiere E2E header en MODE=test, fallback a Bearer productivo.
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(await apiAuthHeaders()),
    },
  });
}`;

function computeApiAuthImportPath(filePath) {
  // src/hooks/foo.ts → ../lib/apiAuth
  // src/services/foo.ts → ../lib/apiAuth
  // src/services/foo/bar.ts → ../../lib/apiAuth
  const rel = relative(join(ROOT, 'src'), filePath);
  const depth = rel.split(/[\\/]/).length - 1; // ej "hooks/foo.ts" → 1 → ../lib
  return `${'../'.repeat(depth)}lib/apiAuth`;
}

function migrateFile(filePath) {
  const original = readFileSync(filePath, 'utf8');
  if (!AUTHED_FETCH_RE.test(original)) {
    return { changed: false, reason: 'pattern-mismatch' };
  }

  let modified = original.replace(AUTHED_FETCH_RE, REPLACEMENT_BODY);

  // Insertar import si no existe ya.
  if (!modified.includes("from '../lib/apiAuth'") && !modified.includes('from "../lib/apiAuth"')) {
    const importPath = computeApiAuthImportPath(filePath);
    const importLine = `import { apiAuthHeaders } from '${importPath}';`;
    // Robustness fix (2026-05-21): los imports multi-línea (`import type {\n  ...\n}`)
    // requieren buscar el último `} from '...'` o `} from "..."` line, no
    // solo `^import` que matchea la cabecera del bloque. Iteramos por TODAS
    // las líneas y trackeamos:
    //   - Si abrimos un brace import (línea termina en `{` post-`import`),
    //     escaneamos hasta encontrar `} from '...';`. Esa es la última
    //     línea de ese import.
    //   - Si es single-line import (`import x from 'y';`), esa misma línea
    //     cuenta.
    // El último import termina justo antes de la primera línea NO-import.
    const lines = modified.split('\n');
    let lastImportEndIdx = -1;
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      // Skip leading comments/blank antes del primer import.
      if (lastImportEndIdx < 0 && (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*'))) {
        i++;
        continue;
      }
      if (/^import\b/.test(trimmed)) {
        // Es start de un import. Buscar dónde termina.
        // Single-line si la línea contiene `from '...'` o `from "..."`.
        if (/from\s+['"][^'"]+['"]\s*;?\s*$/.test(line)) {
          lastImportEndIdx = i;
          i++;
        } else if (line.includes('{') && !line.includes('}')) {
          // Multi-line: scan hasta `} from '...'`
          let j = i + 1;
          while (j < lines.length) {
            if (/}\s*from\s+['"][^'"]+['"]\s*;?\s*$/.test(lines[j])) {
              lastImportEndIdx = j;
              break;
            }
            j++;
          }
          i = j + 1;
        } else {
          // Side-effect import o malformado — count as is.
          lastImportEndIdx = i;
          i++;
        }
      } else if (trimmed === '') {
        // Blank line between imports OK.
        i++;
      } else {
        // First non-import, non-blank, non-comment line — stop.
        break;
      }
    }
    if (lastImportEndIdx >= 0) {
      lines.splice(lastImportEndIdx + 1, 0, importLine);
      modified = lines.join('\n');
    } else {
      modified = importLine + '\n' + modified;
    }
  }

  // Remover import { auth } from '../services/firebase' si ya no se usa.
  // Detect: el import existe + `auth.` ya no aparece en el resto del file
  // (excepto en la línea del import mismo).
  const authImportRe = /^import\s+\{\s*auth\s*\}\s+from\s+['"][^'"]+\/services\/firebase['"];\s*\n/m;
  const authImportMatch = authImportRe.exec(modified);
  if (authImportMatch) {
    // Buscar usos de `auth.` excluyendo la línea del import.
    const withoutImport = modified.slice(0, authImportMatch.index) +
      modified.slice(authImportMatch.index + authImportMatch[0].length);
    const usesAuth = /\bauth\.[a-zA-Z_]/.test(withoutImport);
    if (!usesAuth) {
      modified = withoutImport;
    }
  }

  if (modified === original) {
    return { changed: false, reason: 'noop' };
  }

  if (!DRY_RUN) {
    writeFileSync(filePath, modified, 'utf8');
  }
  return { changed: true, importPath: computeApiAuthImportPath(filePath) };
}

const files = walk(HOOKS_DIR);
let migrated = 0;
let skipped = 0;
const skippedFiles = [];

for (const f of files) {
  const r = migrateFile(f);
  if (r.changed) {
    migrated++;
    console.log(`✓ migrated: ${relative(ROOT, f)} (import: ${r.importPath})`);
  } else if (r.reason === 'pattern-mismatch') {
    skipped++;
    skippedFiles.push(relative(ROOT, f));
  }
}

console.log('');
console.log(`Summary: ${migrated} migrated, ${skipped} skipped (pattern-mismatch).`);
console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no files written)' : 'WRITE'}`);

if (skippedFiles.length > 0 && process.env.VERBOSE) {
  console.log('\nSkipped (review manually):');
  for (const f of skippedFiles.slice(0, 20)) {
    console.log(`  - ${f}`);
  }
  if (skippedFiles.length > 20) {
    console.log(`  ... and ${skippedFiles.length - 20} more`);
  }
}
