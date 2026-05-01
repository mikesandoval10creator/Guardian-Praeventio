// Praeventio Guard — Bsale PSE adapter (STUB ONLY).
//
// Bsale (https://www.bsale.cl/) is a full Chilean ERP that bundles SII
// emission with inventory / POS modules. Heavier integration than the
// REST-only PSEs — only worth picking if Praeventio later wants the ERP
// features. Stub kept here so `getSiiAdapter()` can route to it without
// breaking type-narrowing.

import { SiiNotImplementedError } from './siiAdapter';
import type { DteRequest, DteResponse, SiiAdapter } from './types';

const BSALE_DOCS_URL = 'https://docs.bsale.dev/';

export const bsaleAdapter: SiiAdapter = {
  name: 'bsale',
  isAvailable: Boolean(process.env.BSALE_ACCESS_TOKEN),
  async emitDte(_request: DteRequest): Promise<DteResponse> {
    throw new SiiNotImplementedError('emitDte', 'Bsale', BSALE_DOCS_URL);
  },
  async getDteStatus(_trackId: string): Promise<DteResponse> {
    throw new SiiNotImplementedError('getDteStatus', 'Bsale', BSALE_DOCS_URL);
  },
};
