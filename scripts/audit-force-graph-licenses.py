"""Offline Cargo notice inventory. Evidence tooling, never a distribution approval."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile

if sys.version_info < (3, 11):
    raise SystemExit('Python >=3.11 is required for the offline license audit')
import tomllib

ROOT = Path(__file__).resolve().parents[1]
CRATE = Path('wasm/force-graph-layout')
INVENTORY = CRATE / 'LICENSES/cargo-license-inventory.json'
COPIES = CRATE / 'LICENSES/crates'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def locked(root):
    data = (root / CRATE / 'Cargo.lock').read_bytes()
    packages = tomllib.loads(data.decode('utf-8'))['package']
    entries = [p for p in packages if p.get('source')]
    for p in entries:
        if p['source'] != 'registry+https://github.com/rust-lang/crates.io-index':
            raise ValueError('unsupported_source: explicit audit required')
    return data, entries


def safe(value):
    if not re.fullmatch(r'[A-Za-z0-9_.+-]+', value) or value in ('.', '..'):
        raise ValueError('unsafe_notice_path')
    return value


def verify_files(root, inventory):
    data, entries = locked(root)
    if inventory['lockSha256'] != digest(data):
        raise ValueError('lock_changed')
    if inventory['distributionApproved'] is not False:
        raise ValueError('inventory_is_not_distribution_approval')
    observed = [{k: p[k] for k in ('name', 'version', 'source', 'archiveSha256')} for p in inventory['packages']]
    expected = [dict(name=p['name'], version=p['version'], source=p['source'], archiveSha256=p['checksum']) for p in entries]
    if observed != expected:
        raise ValueError('package_coverage_mismatch')
    names = set()
    for p in inventory['packages']:
        if not p['license'] or not p['documents']:
            raise ValueError('license_missing')
        folder = safe(p['name']) + '-' + safe(p['version'])
        for doc in p['documents']:
            relative = folder + '/' + safe(doc['file'])
            if relative in names:
                raise ValueError('duplicate_notice')
            names.add(relative)
            f = root / COPIES / relative
            if not f.resolve().is_relative_to((root / COPIES).resolve()):
                raise ValueError('unsafe_notice_path')
            raw = f.read_bytes()
            if digest(raw) != doc['sha256'] or len(raw) != doc['sizeBytes']:
                raise ValueError('notice_changed: ' + relative)
    actual = {p.relative_to(root / COPIES).as_posix() for p in (root / COPIES).rglob('*') if p.is_file()}
    if actual != names | {'.gitattributes'}:
        raise ValueError('unexpected_notice_files')
    if (root / COPIES / '.gitattributes').read_text().strip() != '* -text':
        raise ValueError('notice_bytes_must_not_be_normalized')


def collect(root):
    before, entries = locked(root)
    cargo = os.environ.get('CARGO') or shutil.which('cargo')
    if not cargo:
        raise ValueError('cargo_missing: prepare pinned toolchain and locked cache')
    result = subprocess.run([cargo, 'metadata', '--locked', '--offline', '--format-version', '1'],
                            cwd=root / CRATE, capture_output=True, text=True, check=True)
    metadata = json.loads(result.stdout)
    root_package = next(p for p in metadata['packages'] if p['id'] == metadata['resolve']['root'])
    packages = {(p['name'], p['version']): p for p in metadata['packages'] if p['source']}
    if set(packages) != {(p['name'], p['version']) for p in entries}:
        raise ValueError('metadata_lock_mismatch')
    if len(metadata['packages']) != len(packages) + 1:
        raise ValueError('unreviewed_path_dependency')
    inventory = dict(schemaVersion=1, scope='All third-party crates in Cargo.lock; build graph, not a binary attribution map',
                     distributionApproved=False, firstPartyCargoLicense=root_package['license'],
                     lockSha256=digest(before), packages=[])
    copies = {}
    for p in entries:
        package = packages[(p['name'], p['version'])]
        if package['source'] != p['source'] or not package['license'] or package['license_file']:
            raise ValueError('license_metadata_requires_review: ' + p['name'])
        folder = Path(package['manifest_path']).parent
        prefix = safe(p['name']) + '-' + safe(p['version'])
        archive = folder.parent.parent.parent / 'cache' / folder.parent.name / (prefix + '.crate')
        if digest(archive.read_bytes()) != p['checksum']:
            raise ValueError('archive_checksum_mismatch: ' + prefix)
        documents = []
        with tarfile.open(archive, 'r:gz') as tar:
            manifest_stream = tar.extractfile(prefix + '/Cargo.toml')
            if manifest_stream is None:
                raise ValueError('archive_manifest_missing')
            manifest_bytes = manifest_stream.read()
            if manifest_bytes != Path(package['manifest_path']).read_bytes():
                raise ValueError('extracted_manifest_mismatch: ' + prefix)
            archive_package = tomllib.loads(manifest_bytes.decode('utf-8'))['package']
            if (archive_package['name'], archive_package['version'], archive_package.get('license')) != (p['name'], p['version'], package['license']):
                raise ValueError('archive_license_metadata_mismatch: ' + prefix)
            for member in sorted(tar.getmembers(), key=lambda m: m.name):
                parts = member.name.split('/')
                if len(parts) != 2 or parts[0] != prefix or not member.isfile():
                    continue
                name = parts[1]
                if not any(s in name.upper() for s in ('LICENSE', 'LICENCE', 'COPYING', 'NOTICE', 'UNLICENSE', 'COPYRIGHT')):
                    continue
                safe(name)
                stream = tar.extractfile(member)
                if stream is None or member.size > 2 * 1024 * 1024:
                    raise ValueError('invalid_notice')
                raw = stream.read()
                if raw != (folder / name).read_bytes():
                    raise ValueError('extracted_notice_mismatch: ' + prefix + '/' + name)
                copies[prefix + '/' + name] = raw
                documents.append(dict(file=name, sha256=digest(raw), sizeBytes=len(raw)))
        if not documents:
            raise ValueError('license_missing: ' + prefix)
        inventory['packages'].append(dict(name=p['name'], version=p['version'], source=p['source'],
                                          archiveSha256=p['checksum'], license=package['license'], documents=documents))
    if before != (root / CRATE / 'Cargo.lock').read_bytes():
        raise ValueError('lock_mutated_during_audit')
    return inventory, copies


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--write', action='store_true')
    modes.add_argument('--check', action='store_true')
    args = parser.parse_args()
    inventory, copies = collect(ROOT)
    if args.write:
        destination = ROOT / INVENTORY
        if destination.exists() and json.loads(destination.read_text(encoding='utf-8')) != inventory:
            raise ValueError('existing_inventory_conflict: explicit re-audit required')
        # Preflight every destination before writing any notice.
        for name, raw in copies.items():
            target = ROOT / COPIES / name
            if target.exists() and target.read_bytes() != raw:
                raise ValueError('existing_notice_conflict: review manually, do not overwrite')
        for name, raw in copies.items():
            target = ROOT / COPIES / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        (ROOT / COPIES / '.gitattributes').write_bytes(b'* -text\n')
        payload = json.dumps(inventory, ensure_ascii=False, indent=2) + '\n'
        destination.write_bytes(payload.encode('utf-8'))
    stored = json.loads((ROOT / INVENTORY).read_text(encoding='utf-8'))
    verify_files(ROOT, stored)
    if stored != inventory:
        raise ValueError('live_registry_inventory_mismatch')
    print(json.dumps(dict(packages=len(inventory['packages']), documents=len(copies),
                          archiveChecksumsVerified=True, noticesMatchAuthenticatedArchives=True,
                          distributionApproved=False)))


if __name__ == '__main__':
    main()
