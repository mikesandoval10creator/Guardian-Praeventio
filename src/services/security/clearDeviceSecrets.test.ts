import { describe, it, expect, vi, beforeEach } from 'vitest';

const clearEncryptedStore = vi.fn(async () => {});
const deleteDeviceKek = vi.fn(async () => {});

vi.mock('./encryptedKvStore', () => ({
  clearEncryptedStore: () => clearEncryptedStore(),
}));
vi.mock('./deviceKek', () => ({
  deleteDeviceKek: () => deleteDeviceKek(),
}));

import { clearDeviceSecrets } from './clearDeviceSecrets';

describe('clearDeviceSecrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEncryptedStore.mockImplementation(async () => {});
    deleteDeviceKek.mockImplementation(async () => {});
  });

  it('borra el store cifrado y la KEK', async () => {
    const res = await clearDeviceSecrets();

    expect(clearEncryptedStore).toHaveBeenCalledOnce();
    expect(deleteDeviceKek).toHaveBeenCalledOnce();
    expect(res).toEqual({ storeCleared: true, kekDeleted: true });
  });

  it('borra el store ANTES que la KEK (al revés dejaría blobs indescifrables)', async () => {
    const order: string[] = [];
    clearEncryptedStore.mockImplementation(async () => {
      order.push('store');
    });
    deleteDeviceKek.mockImplementation(async () => {
      order.push('kek');
    });

    await clearDeviceSecrets();

    expect(order).toEqual(['store', 'kek']);
  });

  it('si el store falla igual borra la KEK y NO lanza (el logout no se puede bloquear)', async () => {
    clearEncryptedStore.mockImplementation(async () => {
      throw new Error('IndexedDB unavailable (private mode)');
    });

    const res = await clearDeviceSecrets();

    expect(res).toEqual({ storeCleared: false, kekDeleted: true });
    // Sin la KEK, el ciphertext que quedó es irrecuperable de todos modos.
    expect(deleteDeviceKek).toHaveBeenCalledOnce();
  });

  it('si la KEK falla NO lanza y reporta el borrado parcial', async () => {
    deleteDeviceKek.mockImplementation(async () => {
      throw new Error('crypto subsystem error');
    });

    const res = await clearDeviceSecrets();

    expect(res).toEqual({ storeCleared: true, kekDeleted: false });
  });
});
