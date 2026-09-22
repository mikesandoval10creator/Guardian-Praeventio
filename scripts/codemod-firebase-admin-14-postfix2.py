#!/usr/bin/env python3
"""
Post-fix #2: handle remaining edge cases from firebase-admin 14 codemod.

Fixes:
1. `getFirestore().FieldValue.serverTimestamp()` → `FieldValue.serverTimestamp()`
2. `getFirestore().FieldValue.delete()` → `FieldValue.delete()`
3. `getFirestore().FieldValue.increment()` → `FieldValue.increment()`
4. `getFirestore().FieldValue.arrayUnion(...)` → `FieldValue.arrayUnion(...)`
5. `getFirestore().FieldValue.arrayRemove(...)` → `FieldValue.arrayRemove(...)`
6. `getFirestore().Timestamp.now()` → `Timestamp.now()`
7. `getFirestore().FieldPath.documentId()` → `FieldPath.documentId()`
8. `admin.firestore.FieldValue` (in test files) → `FieldValue`
9. `admin.firestore.Timestamp` → `Timestamp`
10. Replace remaining `admin.firestore`, `admin.auth`, etc. as bare refs (not calls)
"""
import re
from pathlib import Path
import sys

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else 'src/')

FIXES = [
    # getFirestore().FieldValue.X(...)
    (re.compile(r'\bgetFirestore\(\)\.FieldValue\b'), 'FieldValue'),
    # getAuth().X (rare but possible)
    # Timestamp usage: getFirestore().Timestamp.now() - already handled by above
    # FieldPath usage: getFirestore().FieldPath.documentId()
    (re.compile(r'\bgetFirestore\(\)\.FieldPath\b'), 'FieldPath'),
    # getFirestore().Timestamp
    (re.compile(r'\bgetFirestore\(\)\.Timestamp\b'), 'Timestamp'),
]

# Also: bare `admin.firestore` (without parens) used as TYPE in test mocks.
# These should be replaced with `typeof getFirestore`.
BARE_TYPE_FIXES = [
    (re.compile(r'\btypeof\s+admin\.firestore\b(?!\s*\()'), 'typeof getFirestore'),
    (re.compile(r'\btypeof\s+admin\.auth\b(?!\s*\()'), 'typeof getAuth'),
]

# Test mocks: `admin.firestore` as a bare VALUE reference (used in vi.mock)
# These need to remain as a way to access getFirestore, but the tests were
# importing `admin` as type. We need to convert type import to value import.

# Find files that import admin as TYPE but use admin.X as VALUE
files_changed = 0
for path in ROOT.rglob('*.ts'):
    if 'node_modules' in str(path):
        continue
    content = path.read_text(encoding='utf-8')
    new = content

    # Fix 1-7: getFirestore().FieldValue.X → FieldValue.X
    for pattern, replacement in FIXES:
        new = pattern.sub(replacement, new)

    # Fix bare type admin.firestore → typeof getFirestore (when used in typeof context)
    for pattern, replacement in BARE_TYPE_FIXES:
        new = pattern.sub(replacement, new)

    # Fix: `admin.firestore` as a bare VALUE (no parens after, not preceded by typeof)
    # We replace bare `admin.firestore` (no `.something` immediately after) with `getFirestore`
    # but only if the next char is NOT `.` (to avoid admin.firestore.X)
    new = re.sub(
        r'\b(?<!typeof\s)admin\.firestore(?!\s*[\(\.])',
        'getFirestore',
        new,
    )
    new = re.sub(
        r'\b(?<!typeof\s)admin\.auth(?!\s*[\(\.])',
        'getAuth',
        new,
    )

    # Fix messaging import: `import { messaging } from 'firebase-admin'`
    # → `import { messaging } from 'firebase-admin/messaging'`
    if "import { messaging }" in new and "from 'firebase-admin';" in new:
        new = new.replace(
            "import { messaging } from 'firebase-admin';",
            "import { messaging } from 'firebase-admin/messaging';",
        )
    if 'import { messaging }' in new and 'from "firebase-admin";' in new:
        new = new.replace(
            'import { messaging } from "firebase-admin";',
            'import { messaging } from "firebase-admin/messaging";',
        )

    # Fix `import type admin` to `import type * as admin` if admin is still used
    # (rare - usually we replaced all admin.X usages)

    if new != content:
        path.write_text(new, encoding='utf-8')
        files_changed += 1

print(f'Post-fix #2 touched {files_changed} files.')
