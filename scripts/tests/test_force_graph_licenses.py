"""Adversarial tests of stored notice validation; real registry audit is separate."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
import io
import tarfile
from types import SimpleNamespace
from unittest import mock

SOURCE = Path(__file__).resolve().parents[1] / 'audit-force-graph-licenses.py'
spec = importlib.util.spec_from_file_location('license_audit', SOURCE)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class NoticeValidation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR'))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copytree(audit.ROOT / audit.COPIES, self.root / audit.COPIES)
        shutil.copyfile(audit.ROOT / audit.CRATE / 'Cargo.lock', self.root / audit.CRATE / 'Cargo.lock')
        self.inventory = json.loads((audit.ROOT / audit.INVENTORY).read_text(encoding='utf-8'))

    def test_valid_committed_notices(self):
        audit.verify_files(self.root, self.inventory)

    def test_missing_transitive_package(self):
        self.inventory['packages'].pop()
        with self.assertRaisesRegex(ValueError, 'package_coverage_mismatch'):
            audit.verify_files(self.root, self.inventory)

    def test_notice_corruption(self):
        p = self.inventory['packages'][0]
        f = self.root / audit.COPIES / (p['name'] + '-' + p['version']) / p['documents'][0]['file']
        f.write_bytes(b'corrupted license fixture')
        with self.assertRaisesRegex(ValueError, 'notice_changed'):
            audit.verify_files(self.root, self.inventory)

    def test_missing_notice(self):
        p = self.inventory['packages'][0]
        (self.root / audit.COPIES / (p['name'] + '-' + p['version']) / p['documents'][0]['file']).unlink()
        with self.assertRaises(FileNotFoundError):
            audit.verify_files(self.root, self.inventory)

    def test_lock_change(self):
        with (self.root / audit.CRATE / 'Cargo.lock').open('ab') as f:
            f.write(b'\n# altered fixture lock\n')
        with self.assertRaisesRegex(ValueError, 'lock_changed'):
            audit.verify_files(self.root, self.inventory)

    def test_no_implicit_distribution_approval(self):
        self.inventory['distributionApproved'] = True
        with self.assertRaisesRegex(ValueError, 'not_distribution_approval'):
            audit.verify_files(self.root, self.inventory)

    def test_unexpected_notice(self):
        (self.root / audit.COPIES / 'unexpected.txt').write_bytes(b'unreviewed fixture')
        with self.assertRaisesRegex(ValueError, 'unexpected_notice_files'):
            audit.verify_files(self.root, self.inventory)

    def test_path_escape(self):
        self.inventory['packages'][0]['documents'][0]['file'] = '../escaped'
        with self.assertRaisesRegex(ValueError, 'unsafe_notice_path'):
            audit.verify_files(self.root, self.inventory)


class ArchiveAuthentication(unittest.TestCase):
    """Synthetic archive fixtures only; never modify the real Cargo cache."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR'))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        folder = self.root / 'registry/src/index/fixture_dep-0.0.0'
        folder.mkdir(parents=True)
        self.manifest = folder / 'Cargo.toml'
        self.manifest.write_bytes(b'[package]\nname="fixture_dep"\nversion="0.0.0"\nlicense="MIT"\n')
        self.notice = folder / 'LICENSE-MIT'
        self.notice.write_bytes(b'Synthetic unit-test notice, not a real published package.\n')
        self.archive = self.root / 'registry/cache/index/fixture_dep-0.0.0.crate'
        self.archive.parent.mkdir(parents=True)
        with tarfile.open(self.archive, 'w:gz') as tar:
            for f in [self.manifest, self.notice]:
                raw = f.read_bytes()
                member = tarfile.TarInfo('fixture_dep-0.0.0/' + f.name)
                member.size = len(raw)
                tar.addfile(member, io.BytesIO(raw))
        lock = self.root / audit.CRATE / 'Cargo.lock'
        lock.parent.mkdir(parents=True)
        lock.write_text('version=4\n[[package]]\nname="fixture_dep"\nversion="0.0.0"\nsource="registry+https://github.com/rust-lang/crates.io-index"\nchecksum="' + audit.digest(self.archive.read_bytes()) + '"\n', encoding='utf-8')
        metadata = dict(resolve=dict(root='root'), packages=[
            dict(id='root', license=None, source=None),
            dict(id='dep', name='fixture_dep', version='0.0.0', source='registry+https://github.com/rust-lang/crates.io-index', license='MIT', license_file=None, manifest_path=str(self.manifest)),
        ])
        self.cargo = mock.patch.object(audit.shutil, 'which', return_value='synthetic-cargo')
        self.process = mock.patch.object(audit.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps(metadata)))
        self.cargo.start()
        self.process.start()
        self.addCleanup(self.cargo.stop)
        self.addCleanup(self.process.stop)

    def test_valid_synthetic_archive_chain(self):
        inventory, copies = audit.collect(self.root)
        self.assertEqual(len(inventory['packages']), 1)
        self.assertEqual(len(copies), 1)

    def test_archive_checksum_corruption(self):
        with self.archive.open('ab') as f:
            f.write(b'corruption fixture')
        with self.assertRaisesRegex(ValueError, 'archive_checksum_mismatch'):
            audit.collect(self.root)

    def test_extracted_manifest_tampering(self):
        with self.manifest.open('ab') as f:
            f.write(b'\n# tampering fixture\n')
        with self.assertRaisesRegex(ValueError, 'extracted_manifest_mismatch'):
            audit.collect(self.root)

    def test_extracted_notice_tampering(self):
        self.notice.write_bytes(b'tampering fixture')
        with self.assertRaisesRegex(ValueError, 'extracted_notice_mismatch'):
            audit.collect(self.root)


if __name__ == '__main__':
    unittest.main()
