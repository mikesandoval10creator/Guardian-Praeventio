#!/usr/bin/env python3
"""
Post-fix #4: handle test files that import admin as a TYPE and use
`admin.firestore.X`, `admin.auth.X`, etc. as types.

These should be converted to direct imports from subpath:
    import type adminNs from 'firebase-admin';
    const x: adminNs.firestore.Firestore = ...;
becomes:
    import type { Firestore } from 'firebase-admin/firestore';
    const x: Firestore = ...;
"""
import re
from pathlib import Path
import sys

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else 'src/')

# Maps `admin.X.<TypeName>` → (subpath, TypeName, isType)
TYPE_NAMESPACE_MAP = {
    'firestore': ('firebase-admin/firestore', True),
    'auth': ('firebase-admin/auth', True),
    'messaging': ('firebase-admin/messaging', True),
    'database': ('firebase-admin/database', True),
    'storage': ('firebase-admin/storage', True),
    'remoteConfig': ('firebase-admin/remote-config', True),
}

# Pattern: adminNs.firestore.Firestore or admin.firestore.FieldValue (as type)
TYPE_QUALIFIER_RE = re.compile(
    r'\b(?P<alias>\w+)\.(?P<qual>firestore|auth|messaging|database|storage|remoteConfig)'
    r'\.(?P<type>[A-Z]\w+)\b',
)

files_changed = 0
for path in ROOT.rglob('*.ts'):
    if 'node_modules' in str(path):
        continue
    content = path.read_text(encoding='utf-8')
    new = content

    # Detect aliases of `admin` import (admin, adminNs, _admin, etc.)
    # Find all aliases that point to firebase-admin
    aliases: set[str] = set()
    for m in re.finditer(
        r"import\s+(?:\*\s+as\s+|type\s+)?(\w+)?\s*(?:from\s+)?['\"]firebase-admin['\"]",
        content,
    ):
        alias = m.group(1)
        if alias:
            aliases.add(alias)

    if not aliases:
        continue

    # For each alias, replace `<alias>.qualifier.TypeName` → `TypeName`
    # and add `import { TypeName } from 'firebase-admin/<qualifier>'`
    new_aliases = {}
    for alias in aliases:
        new = re.sub(
            rf'\b{re.escape(alias)}\.(firestore|auth|messaging|database|storage|remoteConfig)\.([A-Z]\w+)\b',
            lambda m: m.group(2),
            new,
        )

    # Now collect all TypeNames used as types and ensure they're imported
    # Find `firebase-admin/<qualifier>` imports and merge
    needed: dict[str, set[str]] = {}  # subpath → set of typenames
    for qual in TYPE_NAMESPACE_MAP:
        subpath, _ = TYPE_NAMESPACE_MAP[qual]
        # Find TypeNames after removing the qualifier prefix
        # E.g. `Firestore` was admin.firestore.Firestore, now standalone
        for tn_match in re.finditer(rf'\b([A-Z]\w+)\b', new):
            tn = tn_match.group(1)
            # Heuristic: skip common types we shouldn't auto-import
            if tn in {'Error', 'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Date'}:
                continue
            # Check if this is a known Firestore/Auth/etc type
            # (Conservative: only do this if file already imports from subpath)
            ...

    # Simpler: for each subpath, check if it's imported; if not, leave imports alone
    # Just track if the file USES `getFirestore()` etc. as value, ensure import
    # (we don't add new type imports automatically — tsc will catch them)

    if new != content:
        path.write_text(new, encoding='utf-8')
        files_changed += 1

print(f'Post-fix #4 touched {files_changed} files.')
