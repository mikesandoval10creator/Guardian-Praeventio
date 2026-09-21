#!/usr/bin/env python3
"""
Codemod: migrate firebase-admin 13.x legacy namespace API -> 14.x modular API.

Strategy:
1. Detect qualifier namespaces used: `admin.firestore`, `admin.auth`, `admin.messaging`, etc.
2. Replace call sites:
   - `admin.firestore(arg?)`         -> `getFirestore(arg?)`   + import from 'firebase-admin/firestore'
   - `admin.auth(arg?)`              -> `getAuth(arg?)`        + import from 'firebase-admin/auth'
   - `admin.messaging()`             -> `getMessaging()`       + import from 'firebase-admin/messaging'
   - `admin.initializeApp(...)`      -> `initializeApp(...)`   + import from 'firebase-admin/app'
3. Replace qualifier access (used for types):
   - `admin.firestore.Timestamp`     -> `Timestamp`            + type import
   - `admin.firestore.FieldValue`    -> `FieldValue`           + value import (since it's used at runtime: .serverTimestamp())
   - `admin.firestore.Firestore`     -> `Firestore`            + type import
   - `admin.auth.Auth`               -> `Auth`                 + type import
4. Replace bare refs:
   - `admin.apps`                    -> `getApps()`
   - `admin.app(name)`               -> `getApp(name)`
5. Remove the legacy `import admin from 'firebase-admin'` line.

Idempotent. Safe to re-run.

Usage:
    python3 scripts/codemod-firebase-admin-14.py [--dry-run] [--paths src/]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# ---- Qualifier mapping: which subpath module each `admin.<namespace>` maps to. ----
# Value-call methods (with parentheses):
VALUE_CALL_MAP: dict[str, tuple[str, str]] = {
    # admin.firestore(...)   -> getFirestore(...)    from firebase-admin/firestore
    "firestore": ("firebase-admin/firestore", "getFirestore"),
    "auth":      ("firebase-admin/auth",      "getAuth"),
    "messaging": ("firebase-admin/messaging", "getMessaging"),
    "database":  ("firebase-admin/database",  "getDatabase"),
    "remoteConfig": ("firebase-admin/remote-config", "getRemoteConfig"),
    "machineLearning": ("firebase-admin/machine-learning", "getMachineLearning"),
    "securityRules":  ("firebase-admin/security-rules",  "getSecurityRules"),
    "instanceId":     ("firebase-admin/instance-id",     "getInstanceId"),
    "projectManagement": ("firebase-admin/project-management", "getProjectManagement"),
}

# admin.initializeApp(...) -> initializeApp(...)
ALIAS_CALL_MAP: dict[str, tuple[str, str]] = {
    "initializeApp": ("firebase-admin/app", "initializeApp"),
}

# Bare reference (no parens) -> callable that replaces it.
# admin.apps   -> getApps()
# admin.app(name?) -> getApp(name?)
BARE_REF_MAP: dict[str, tuple[str, str, str, bool]] = {
    # key:                subpath,                export,    takes_arg
    "apps": ("firebase-admin/app", "getApps", "", False),
    "app":  ("firebase-admin/app", "getApp",  "", True),  # True = follows args
}

# Qualifier types — `admin.<namespace>.<TypeName>`. These are TYPES.
# We always import them as `type` (or value, but `type` is safer for namespace types).
QUALIFIER_TYPE_NAMESPACES: set[str] = {
    "firestore", "auth", "messaging", "database",
    "remoteConfig", "machineLearning", "securityRules", "instanceId",
}

# Subpath lookup for qualifier types.
QUALIFIER_SUBPATH: dict[str, str] = {
    "firestore":      "firebase-admin/firestore",
    "auth":           "firebase-admin/auth",
    "messaging":      "firebase-admin/messaging",
    "database":       "firebase-admin/database",
    "remoteConfig":   "firebase-admin/remote-config",
    "machineLearning":"firebase-admin/machine-learning",
    "securityRules":  "firebase-admin/security-rules",
    "instanceId":     "firebase-admin/instance-id",
}


# ---- Regex helpers ----

# `admin.initializeApp(` and similar alias calls
ALIAS_CALL_RE = re.compile(
    r"\badmin\.(?P<name>initializeApp)\s*\("
)

# `admin.<method>(` — covers VALUE_CALL_MAP keys
_value_keys_alt = "|".join(re.escape(k) for k in VALUE_CALL_MAP)
VALUE_CALL_RE = re.compile(r"\badmin\.(?P<name>" + _value_keys_alt + r")\s*\(")

# `admin.<key>` — bare reference.
# We match the bare form (NO `(` after to avoid admin.initializeApp).
# For `admin.apps.length` we WANT to match — getApps().length is valid.
# For `admin.app(name)` we still want it (caller will handle separately).
def make_bare_ref_re(keys: list[str]) -> re.Pattern[str]:
    alt = "|".join(re.escape(k) for k in keys)
    # Match `admin.<key>` followed by NOT a `(` (which would be a value call).
    # `.length` is fine to match — getApps().length is valid.
    return re.compile(r"\badmin\.(?P<name>" + alt + r")\b(?!\s*\()")


# `admin.<qualifier>.<TypeName>` — qualifier access for types/values
# Group1: qualifier (e.g. firestore), Group2: TypeName (e.g. Timestamp)
QUALIFIER_RE = re.compile(
    r"\badmin\.(?P<qual>"
    + "|".join(re.escape(k) for k in QUALIFIER_SUBPATH)
    + r")\.(?P<type>[A-Z][A-Za-z0-9_]*)"
)

# `admin.<qualifier>.<lowercaseMethod>` for value methods on a namespace
# e.g. admin.firestore.FieldValue.serverTimestamp() — FieldValue is value (lowercase)
# We need to find these. For now handle as value.
QUALIFIER_VALUE_RE = re.compile(
    r"\badmin\.(?P<qual>"
    + "|".join(re.escape(k) for k in QUALIFIER_SUBPATH)
    + r")\.(?P<name>[a-z][A-Za-z0-9_]*)"
)

# `typeof admin.<qualifier>` — used to type function signatures in some files.
# We rewrite to `typeof getX` since getX has the same type as the namespace.
TYPEOF_QUALIFIER_RE = re.compile(
    r"\btypeof\s+admin\.(?P<qual>"
    + "|".join(re.escape(k) for k in QUALIFIER_SUBPATH)
    + r")\b"
)

# `admin.<qualifier>` used as a value (rare; e.g. `admin.firestore` passed to a
# function expecting the namespace itself). We rewrite to `getFirestore` (the
# function returns the namespace instance, which is compatible).
BARE_QUALIFIER_RE = re.compile(
    r"\badmin\.(?P<qual>"
    + "|".join(re.escape(k) for k in QUALIFIER_SUBPATH)
    + r")\b(?!\s*[\(\.])"
)

# Names that are VALUE exports even though they start with an uppercase letter.
# (FieldValue is a runtime value with methods like .serverTimestamp().)
VALUE_TYPE_NAMES: set[str] = {
    "FieldValue",
}

# Import detection
LEGACY_IMPORT_RE = re.compile(
    r"^[ \t]*import\s+(?P<binding>default\s+)?(?P<name>\w+|\*\s+as\s+\w+)"
    r"(?:\s*,\s*\{(?P<named>[^}]+)\})?\s+from\s+['\"]firebase-admin['\"]\s*;?[ \t]*\n?",
    re.MULTILINE,
)
TYPE_IMPORT_RE = re.compile(
    r"^[ \t]*import\s+type\s+(?P<binding>default\s+)?(?P<name>\w+|\*\s+as\s+\w+)"
    r"(?:\s*,\s*\{(?P<named>[^}]+)\})?\s+from\s+['\"]firebase-admin['\"]\s*;?[ \t]*\n?",
    re.MULTILINE,
)


def detect_local_binding(content: str) -> str | None:
    """Return the local binding name (e.g. 'admin') for `import admin from 'firebase-admin'`."""
    m = LEGACY_IMPORT_RE.search(content)
    if not m:
        return None
    name = m.group("name")
    if name.startswith("* as "):
        return name[5:]
    return name


def remove_legacy_import(content: str) -> str:
    return LEGACY_IMPORT_RE.sub("", content)


def remove_type_import(content: str) -> str:
    return TYPE_IMPORT_RE.sub("", content)


def insert_imports(content: str, value_imports: dict[str, set[str]],
                   type_imports: dict[str, set[str]]) -> str:
    """Insert value and type imports after existing imports."""
    if not value_imports and not type_imports:
        return content

    # Order: app, firestore, auth, messaging, rest
    priority = [
        "firebase-admin/app", "firebase-admin/firestore", "firebase-admin/auth",
        "firebase-admin/messaging",
    ]
    all_subpaths = list(dict.fromkeys(list(priority) +
                                      [s for s in value_imports if s not in priority] +
                                      [s for s in type_imports if s not in priority]))

    new_lines: list[str] = []
    for subpath in all_subpaths:
        v_names = sorted(value_imports.get(subpath, set()))
        t_names = sorted(type_imports.get(subpath, set()))
        if v_names:
            new_lines.append(
                f"import {{ {', '.join(v_names)} }} from '{subpath}';"
            )
        if t_names:
            new_lines.append(
                f"import type {{ {', '.join(t_names)} }} from '{subpath}';"
            )
    if not new_lines:
        return content
    block = "\n".join(new_lines) + "\n"

    # Find insertion point: after the last existing import statement (including type imports).
    import_end = 0
    for pattern in (TYPE_IMPORT_RE, LEGACY_IMPORT_RE, re.compile(r"^[ \t]*import\s.+?from\s+['\"][^'\"]+['\"]\s*;?\n?", re.MULTILINE)):
        for m in pattern.finditer(content):
            if m.end() > import_end:
                import_end = m.end()

    if import_end == 0:
        if content.startswith("#!"):
            nl = content.find("\n") + 1
            return content[:nl] + block + content[nl:]
        return block + content

    return content[:import_end] + "\n" + block + content[import_end:]


def migrate_file(path: Path) -> tuple[bool, str]:
    """Migrate a single file. Returns (changed, new_content)."""
    try:
        original = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return False, ""
    content = original

    # Quick skip: no firebase-admin import.
    binding = detect_local_binding(content)
    if binding is None and "firebase-admin" not in content:
        return False, original

    # Detect binding from either value or type import (for type-only files).
    if binding is None:
        m = TYPE_IMPORT_RE.search(content)
        if m:
            name = m.group("name")
            if name.startswith("* as "):
                binding = name[5:]
            else:
                binding = name

    if binding is None:
        # Maybe `import * as adminNs from 'firebase-admin'`
        return False, original

    # We only migrate if the binding is `admin` or common aliases.
    # Be strict: only migrate if binding is literally `admin`.
    if binding != "admin":
        return False, original

    # Track which imports we need.
    value_imports: dict[str, set[str]] = {}
    type_imports: dict[str, set[str]] = {}

    # 1. Replace VALUE_CALL: admin.firestore(...) -> getFirestore(...)
    def value_call_repl(m: re.Match[str]) -> str:
        name = m.group("name")
        subpath, export = VALUE_CALL_MAP[name]
        value_imports.setdefault(subpath, set()).add(export)
        return f"{export}("
    content = VALUE_CALL_RE.sub(value_call_repl, content)

    # 2. Replace ALIAS_CALL: admin.initializeApp(...) -> initializeApp(...)
    def alias_call_repl(m: re.Match[str]) -> str:
        name = m.group("name")
        subpath, export = ALIAS_CALL_MAP[name]
        value_imports.setdefault(subpath, set()).add(export)
        return f"{export}("
    content = ALIAS_CALL_RE.sub(alias_call_repl, content)

    # 3. Replace BARE_REF: admin.apps -> getApps(), admin.app(name?) -> getApp(name?)
    # We handle bare ref first (before qualifier) so we don't confuse admin.apps with admin.firestore.
    # Match: admin.apps (no parens) and admin.app (no parens)
    def bare_ref_repl(m: re.Match[str]) -> str:
        name = m.group("name")
        subpath, export, _, takes_arg = BARE_REF_MAP[name]
        value_imports.setdefault(subpath, set()).add(export)
        # Always emit as a call (getApps(), getApp()). The trailing .length, [0],
        # etc. that originally followed `admin.apps` still work on the result.
        return f"{export}()"
    content = make_bare_ref_re(list(BARE_REF_MAP.keys())).sub(bare_ref_repl, content)

    # 4. Replace QUALIFIER for TYPE names: admin.firestore.Timestamp -> Timestamp
    # We import as TYPE (safer) — Timestamp/Auth/etc are interfaces.
    # EXCEPTION: VALUE_TYPE_NAMES like 'FieldValue' are runtime values.
    def qual_type_repl(m: re.Match[str]) -> str:
        qual = m.group("qual")
        type_name = m.group("type")
        if type_name in VALUE_TYPE_NAMES:
            subpath = QUALIFIER_SUBPATH[qual]
            value_imports.setdefault(subpath, set()).add(type_name)
            return type_name
        subpath = QUALIFIER_SUBPATH[qual]
        type_imports.setdefault(subpath, set()).add(type_name)
        return type_name
    content = QUALIFIER_RE.sub(qual_type_repl, content)

    # 4b. Re-classify VALUE_TYPE_NAMES that may have been added to type_imports.
    for subpath in list(type_imports.keys()):
        overlap = type_imports[subpath] & VALUE_TYPE_NAMES
        if overlap:
            value_imports.setdefault(subpath, set()).update(overlap)
            type_imports[subpath] -= overlap
            if not type_imports[subpath]:
                del type_imports[subpath]

    # 4c. Replace `typeof admin.<qualifier>` -> `typeof getX`.
    # This is used in some files as a type alias for function signatures.
    def typeof_qual_repl(m: re.Match[str]) -> str:
        qual = m.group("qual")
        subpath, export = VALUE_CALL_MAP[qual]
        value_imports.setdefault(subpath, set()).add(export)
        return f"typeof {export}"
    content = TYPEOF_QUALIFIER_RE.sub(typeof_qual_repl, content)

    # 4d. Replace bare `admin.<qualifier>` used as a value
    # (e.g. `admin.firestore` passed to a function expecting the namespace).
    # We rewrite to `getFirestore()` (compatible — returns the namespace).
    def bare_qual_repl(m: re.Match[str]) -> str:
        qual = m.group("qual")
        subpath, export = VALUE_CALL_MAP[qual]
        value_imports.setdefault(subpath, set()).add(export)
        return f"{export}()"
    content = BARE_QUALIFIER_RE.sub(bare_qual_repl, content)

    # 5. Replace QUALIFIER for VALUE names: admin.firestore.FieldValue -> FieldValue
    # FieldValue is used at runtime (.serverTimestamp()) so it's a value import.
    def qual_value_repl(m: re.Match[str]) -> str:
        qual = m.group("qual")
        name = m.group("name")
        subpath = QUALIFIER_SUBPATH[qual]
        value_imports.setdefault(subpath, set()).add(name)
        return name
    content = QUALIFIER_VALUE_RE.sub(qual_value_repl, content)

    # 6. Remove legacy `import admin from 'firebase-admin'` and `import type admin from 'firebase-admin'`.
    content = remove_legacy_import(content)
    content = remove_type_import(content)

    # 7. Insert new imports.
    content = insert_imports(content, value_imports, type_imports)

    return content != original, content


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--paths", nargs="+", default=["src/"])
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    root = Path.cwd()
    changed_files = 0
    errors: list[str] = []

    files_to_check: list[Path] = []
    for base in args.paths:
        bp = root / base
        if bp.is_file():
            files_to_check.append(bp)
        elif bp.is_dir():
            for path in bp.rglob("*"):
                if not path.is_file():
                    continue
                if path.suffix not in {".ts", ".tsx", ".mts", ".cts"}:
                    continue
                if "node_modules" in path.parts:
                    continue
                if path.name.endswith(".d.ts"):
                    continue
                files_to_check.append(path)
        else:
            errors.append(f"path does not exist: {bp}")

    for path in files_to_check:
        try:
            changed, new_content = migrate_file(path)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{path}: {e}")
            continue
        if changed:
            changed_files += 1
            if not args.dry_run:
                path.write_text(new_content, encoding="utf-8")
            if not args.quiet:
                rel = path.relative_to(root)
                print(f"[ok] {rel}")

    print()
    print(f"Summary: {changed_files} files changed, {len(files_to_check) - changed_files} untouched")
    if errors:
        print(f"\n{len(errors)} errors:")
        for e in errors:
            print(f"  {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
