#!/usr/bin/env python3
"""Check 64-bit ELF LOAD segments inside an AAB; APK zip alignment is separate."""
import struct
import sys
import zipfile


def check_elf(data):
    if len(data) < 64 or data[:6] != b'\x7fELF\x02\x01':
        raise ValueError('expected little-endian ELF64')
    offset = struct.unpack_from('<Q', data, 32)[0]
    size, count = struct.unpack_from('<HH', data, 54)
    if size < 56 or count == 0 or offset + size * count > len(data):
        raise ValueError('invalid ELF program headers')
    loads = 0
    for index in range(count):
        header = offset + index * size
        if struct.unpack_from('<I', data, header)[0] != 1:
            continue
        loads += 1
        file_offset, address = struct.unpack_from('<QQ', data, header + 8)
        alignment = struct.unpack_from('<Q', data, header + 48)[0]
        if alignment < 16384 or alignment & (alignment - 1) or (file_offset - address) % 16384:
            raise ValueError('LOAD segment is not compatible with 16 KB pages')
    if not loads:
        raise ValueError('no LOAD segments')


def main():
    failures = []
    checked = 0
    with zipfile.ZipFile(sys.argv[1]) as archive:
        for name in archive.namelist():
            if name.endswith('.so') and any('/lib/' + abi + '/' in name for abi in ('arm64-v8a', 'x86_64')):
                checked += 1
                try:
                    check_elf(archive.read(name))
                except ValueError as error:
                    failures.append(f'{name}: {error}')
    if not checked:
        failures.append('no 64-bit native libraries found')
    for failure in failures:
        print(f'FAIL: {failure}', file=sys.stderr)
    if failures:
        return 1
    print(f'PASS: {checked} ELF64 libraries; APK zip alignment and device execution still required')
    return 0


if __name__ == '__main__':
    sys.exit(main())
