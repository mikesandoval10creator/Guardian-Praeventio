import { describe, it, expect } from 'vitest';
import {
  base32Encode,
  base32Decode,
  hotp,
  totp,
  verifyTotp,
  generateSecret,
  buildProvisioningUri,
  generateRecoveryCodes,
} from './totp.js';

// ────────────────────────────────────────────────────────────────────────
// Base32 — vectores RFC 4648
// ────────────────────────────────────────────────────────────────────────

describe('base32 RFC 4648', () => {
  it('empty', () => {
    expect(base32Encode(new Uint8Array(0))).toBe('');
    expect(base32Decode('')).toEqual(new Uint8Array(0));
  });

  it('"foo" → MZXW6', () => {
    const bytes = new TextEncoder().encode('foo');
    expect(base32Encode(bytes)).toBe('MZXW6');
  });

  it('"foobar" → MZXW6YTBOI', () => {
    const bytes = new TextEncoder().encode('foobar');
    expect(base32Encode(bytes)).toBe('MZXW6YTBOI');
  });

  it('roundtrip random bytes', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]);
    const encoded = base32Encode(bytes);
    const decoded = base32Decode(encoded);
    expect(decoded).toEqual(bytes);
  });

  it('decode ignora espacios y lowercase', () => {
    const encoded = base32Encode(new TextEncoder().encode('foo'));
    expect(base32Decode(encoded.toLowerCase())).toEqual(new TextEncoder().encode('foo'));
    expect(base32Decode(`m z x w 6`)).toEqual(new TextEncoder().encode('foo'));
  });

  it('decode rechaza chars inválidos', () => {
    expect(() => base32Decode('NOT_VALID!')).toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────
// HOTP — RFC 4226 Appendix D test vectors
// Secret = "12345678901234567890" (ASCII, 20 bytes)
// ────────────────────────────────────────────────────────────────────────

const HOTP_SECRET = new TextEncoder().encode('12345678901234567890');

describe('hotp — RFC 4226 Appendix D', () => {
  const expectedCodes = [
    '755224', // counter 0
    '287082', // 1
    '359152', // 2
    '969429', // 3
    '338314', // 4
    '254676', // 5
    '287922', // 6
    '162583', // 7
    '399871', // 8
    '520489', // 9
  ];

  expectedCodes.forEach((expected, counter) => {
    it(`counter=${counter} → ${expected}`, () => {
      expect(hotp(HOTP_SECRET, counter, 6)).toBe(expected);
    });
  });

  it('digits=8', () => {
    expect(hotp(HOTP_SECRET, 0, 8)).toBe('84755224');
  });

  it('digits inválido lanza', () => {
    expect(() => hotp(HOTP_SECRET, 0, 5)).toThrow();
    expect(() => hotp(HOTP_SECRET, 0, 9)).toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────
// TOTP — RFC 6238 Appendix B test vectors (SHA-1, T0=0, X=30s)
// Secret = "12345678901234567890"
// ────────────────────────────────────────────────────────────────────────

describe('totp — RFC 6238 Appendix B', () => {
  // (timeUnixSec, expected 8-digit code)
  const cases: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  cases.forEach(([ts, expected]) => {
    it(`t=${ts} → ${expected}`, () => {
      expect(
        totp(HOTP_SECRET, { nowSec: ts, digits: 8 }),
      ).toBe(expected);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// verifyTotp — clock drift tolerance
// ────────────────────────────────────────────────────────────────────────

describe('verifyTotp', () => {
  it('código actual: delta=0', () => {
    const now = 1700000000;
    const code = totp(HOTP_SECRET, { nowSec: now });
    expect(verifyTotp(HOTP_SECRET, code, { nowSec: now })).toBe(0);
  });

  it('código del step previo (drift 30s atrás): delta=-1 con window=1', () => {
    const now = 1700000000;
    const prev = totp(HOTP_SECRET, { nowSec: now - 30 });
    expect(verifyTotp(HOTP_SECRET, prev, { nowSec: now, windowSteps: 1 })).toBe(-1);
  });

  it('código del step siguiente (drift 30s adelante): delta=+1', () => {
    const now = 1700000000;
    const next = totp(HOTP_SECRET, { nowSec: now + 30 });
    expect(verifyTotp(HOTP_SECRET, next, { nowSec: now, windowSteps: 1 })).toBe(1);
  });

  it('código fuera de window: null', () => {
    const now = 1700000000;
    const farPast = totp(HOTP_SECRET, { nowSec: now - 120 });
    expect(verifyTotp(HOTP_SECRET, farPast, { nowSec: now, windowSteps: 1 })).toBeNull();
  });

  it('código incorrecto: null', () => {
    const now = 1700000000;
    expect(verifyTotp(HOTP_SECRET, '000000', { nowSec: now })).toBeNull();
  });

  it('código de longitud distinta: null (no crashea)', () => {
    expect(verifyTotp(HOTP_SECRET, '12345', { nowSec: 1700000000 })).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// generateSecret + provisioning
// ────────────────────────────────────────────────────────────────────────

describe('generateSecret', () => {
  it('genera 20 bytes raw + Base32 32-char', () => {
    const { raw, base32 } = generateSecret();
    expect(raw).toHaveLength(20);
    expect(base32).toHaveLength(32); // ceil(20*8/5) = 32
  });

  it('cada llamada produce un secret distinto', () => {
    const a = generateSecret().base32;
    const b = generateSecret().base32;
    expect(a).not.toBe(b);
  });

  it('roundtrip: Base32 → raw → genera el mismo TOTP', () => {
    const { raw, base32 } = generateSecret();
    const codeRaw = totp(raw, { nowSec: 1700000000 });
    const codeDecoded = totp(base32Decode(base32), { nowSec: 1700000000 });
    expect(codeRaw).toBe(codeDecoded);
  });
});

describe('buildProvisioningUri', () => {
  it('URI canónico otpauth://totp/...', () => {
    const uri = buildProvisioningUri({
      accountName: 'juan@empresa.cl',
      secretBase32: 'JBSWY3DPEHPK3PXP',
    });
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Praeventio');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('issuer custom', () => {
    const uri = buildProvisioningUri({
      accountName: 'a@b.cl',
      secretBase32: 'ABCD',
      issuer: 'OtraEmpresa',
    });
    expect(uri).toContain('issuer=OtraEmpresa');
    expect(uri).toContain('OtraEmpresa:a%40b.cl');
  });

  it('account name encoded', () => {
    const uri = buildProvisioningUri({
      accountName: 'juan+test@empresa.cl',
      secretBase32: 'ABCD',
    });
    // + y @ deben estar URL-encoded
    expect(uri).toContain('Praeventio:juan%2Btest%40empresa.cl');
  });
});

describe('generateRecoveryCodes', () => {
  it('10 códigos por default, formato XXXX-XXXX', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    }
  });

  it('sin 0/O/1/I (chars confundibles)', () => {
    const codes = generateRecoveryCodes(50);
    for (const c of codes) {
      expect(c).not.toMatch(/[01OI]/);
    }
  });

  it('count custom', () => {
    expect(generateRecoveryCodes(3)).toHaveLength(3);
  });

  it('códigos únicos entre sí (con N=20 collision improbable)', () => {
    const codes = generateRecoveryCodes(20);
    expect(new Set(codes).size).toBe(20);
  });
});
