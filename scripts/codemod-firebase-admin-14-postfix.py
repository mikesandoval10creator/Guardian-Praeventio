#!/usr/bin/env python3
"""
Post-fix: replace leftover `admin.firestore()` / `admin.auth()` patterns that the main
codemod missed due to multi-line whitespace between `admin` and `.firestore()`.

Also ensures imports for getFirestore/getAuth exist; adds them if not.
"""
import re
from pathlib import Path

PATTERNS = [
    # admin\s*\n?\s*\.firestore() → getFirestore()
    (re.compile(r'\badmin\s*\n?\s*\.firestore\(\)'), 'getFirestore()',
     {'from \'firebase-admin/firestore\'', 'from "firebase-admin/firestore"'},
     'getFirestore', 'value'),
    # admin\s*\n?\s*\.auth() → getAuth()
    (re.compile(r'\badmin\s*\n?\s*\.auth\(\)'), 'getAuth()',
     {'from \'firebase-admin/auth\'', 'from "firebase-admin/auth"'},
     'getAuth', 'value'),
    # admin\s*\n?\s*\.apps() → getApps()
    (re.compile(r'\badmin\s*\n?\s*\.apps\(\)'), 'getApps()',
     {'from \'firebase-admin/app\'', 'from "firebase-admin/app"'},
     'getApps', 'value'),
    # admin\s*\n?\s*\.apps (no parens) → getApps()
    (re.compile(r'\badmin\s*\n?\s*\.apps\b(?!\s*\()'), 'getApps()',
     {'from \'firebase-admin/app\'', 'from "firebase-admin/app"'},
     'getApps', 'value'),
    # admin\s*\n?\s*\.messaging() → getMessaging()
    (re.compile(r'\badmin\s*\n?\s*\.messaging\(\)'), 'getMessaging()',
     {'from \'firebase-admin/messaging\'', 'from "firebase-admin/messaging"'},
     'getMessaging', 'value'),
    # typeof admin.firestore → typeof getFirestore
    (re.compile(r'\btypeof\s+admin\s*\n?\s*\.firestore\b(?!\s*\()'), 'typeof getFirestore',
     {'from \'firebase-admin/firestore\'', 'from "firebase-admin/firestore"'},
     'getFirestore', 'type'),
    # typeof admin.auth → typeof getAuth
    (re.compile(r'\btypeof\s+admin\s*\n?\s*\.auth\b(?!\s*\()'), 'typeof getAuth',
     {'from \'firebase-admin/auth\'', 'from "firebase-admin/auth"'},
     'getAuth', 'type'),
]

import sys
root = Path(sys.argv[1] if len(sys.argv) > 1 else 'src/')

changed = 0
files_touched = []
for path in root.rglob('*.ts'):
    if 'node_modules' in str(path):
        continue
    content = path.read_text(encoding='utf-8')
    new = content
    for pattern, replacement, import_markers, sym, kind in PATTERNS:
        if pattern.search(new):
            # Check if import exists
            import_marker_list = list(import_markers)
            has_import = any(m in new for m in import_marker_list)
            if not has_import:
                # Add import — extract subpath from first marker (strip 'from ' and quotes/semicolon).
                first_marker = import_marker_list[0]
                if first_marker.endswith(';'):
                    first_marker = first_marker[:-1]
                # 'from \'firebase-admin/firestore\'' → 'firebase-admin/firestore'
                subpath = first_marker.split('from')[1].strip().strip('\'"')
                import_stmt = f"import {{ {sym} }} from '{subpath}';\n"
                # Insert after last import
                last_import = None
                for m in re.finditer(r'^[ \t]*import\s.+?from\s+["\'][^"\']+["\']\s*;?', new, re.MULTILINE):
                    last_import = m
                if last_import:
                    insert_pos = last_import.end()
                    # Skip newlines after
                    while insert_pos < len(new) and new[insert_pos] in '\n':
                        insert_pos += 1
                    new = new[:insert_pos] + import_stmt + new[insert_pos:]
                else:
                    new = import_stmt + new
            new = pattern.sub(replacement, new)
    if new != content:
        path.write_text(new, encoding='utf-8')
        changed += 1
        files_touched.append(str(path))

print(f'Post-fix touched {changed} files.')
for f in files_touched[:5]:
    print(' ', f)
if len(files_touched) > 5:
    print(f'  ... and {len(files_touched) - 5} more')
