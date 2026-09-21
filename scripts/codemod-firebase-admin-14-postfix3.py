#!/usr/bin/env python3
"""
Post-fix #3: convert `firestoreNamespace.FieldValue.serverTimestamp()`
to `FieldValue.serverTimestamp()` and add `FieldValue` import where needed.

In firebase-admin 13, `admin.firestore` was a namespace with `.FieldValue`.
In firebase-admin 14, `FieldValue` is a top-level export from
`firebase-admin/firestore`. The codemod incorrectly preserved the property
access on `getFirestore` (which has no `.FieldValue`).
"""
import re
from pathlib import Path
import sys

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else 'src/')

files_changed = 0
for path in ROOT.rglob('*.ts'):
    if 'node_modules' in str(path):
        continue
    content = path.read_text(encoding='utf-8')
    new = content

    # Replace `something.firestoreNamespace.FieldValue` → `FieldValue`
    # (covers both `deps.firestoreNamespace.FieldValue` and `firestoreNamespace.FieldValue`)
    new = re.sub(
        r'\b\w+\.firestoreNamespace\.FieldValue\b',
        'FieldValue',
        new,
    )

    # If FieldValue is now used but not imported, add it
    if 'FieldValue.' in new and not re.search(r"import\s+.*\bFieldValue\b.*from\s+['\"]firebase-admin/firestore['\"]", new):
        # Add to existing firebase-admin/firestore import or create one
        existing = re.search(
            r"import\s*\{([^}]+)\}\s*from\s*['\"]firebase-admin/firestore['\"]",
            new,
        )
        if existing:
            current = existing.group(1)
            if 'FieldValue' not in current:
                new_symbols = current.strip() + ', FieldValue'
                # Sort alphabetically
                new_symbols = ', '.join(sorted(s.strip() for s in new_symbols.split(',') if s.strip()))
                new = new.replace(existing.group(0), f"import {{ {new_symbols} }} from 'firebase-admin/firestore'")
        else:
            # Insert after last import
            last_import = None
            for m in re.finditer(r'^[ \t]*import\s.+?from\s+["\'][^"\']+["\']\s*;?', new, re.MULTILINE):
                last_import = m
            if last_import:
                insert_pos = last_import.end() + 1  # after the newline
                new = new[:insert_pos] + "import { FieldValue } from 'firebase-admin/firestore';\n" + new[insert_pos:]

    if new != content:
        path.write_text(new, encoding='utf-8')
        files_changed += 1

print(f'Post-fix #3 touched {files_changed} files.')
