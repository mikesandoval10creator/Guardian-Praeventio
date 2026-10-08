import importlib.util
from pathlib import Path
import struct
import unittest

spec = importlib.util.spec_from_file_location('alignment', Path(__file__).parents[1] / 'check-android-16kb.py')
alignment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alignment)


def elf(load_alignment=16384, address=0, file_offset=0):
    data = bytearray(120)
    data[:6] = b'\x7fELF\x02\x01'
    struct.pack_into('<Q', data, 32, 64)
    struct.pack_into('<HH', data, 54, 56, 1)
    struct.pack_into('<IIQQQQQQ', data, 64, 1, 5, file_offset, address, 0, 120, 120, load_alignment)
    return data


class AlignmentTests(unittest.TestCase):
    def test_accepts_16_and_64_kb_segments(self):
        alignment.check_elf(elf())
        alignment.check_elf(elf(65536))

    def test_rejects_4_kb_and_invalid_alignment(self):
        for value in (4096, 0, 24576):
            with self.subTest(alignment=value), self.assertRaises(ValueError):
                alignment.check_elf(elf(value))

    def test_rejects_incompatible_segment_offsets(self):
        with self.assertRaises(ValueError):
            alignment.check_elf(elf(address=4096))

    def test_rejects_truncated_headers_and_other_formats(self):
        for data in (elf()[:100], b'not an ELF', b'\x7fELF\x01\x01' + bytes(120)):
            with self.subTest(data=data[:8]), self.assertRaises(ValueError):
                alignment.check_elf(data)


if __name__ == '__main__':
    unittest.main()
