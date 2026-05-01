// Praeventio Guard — LibreDTE PSE adapter (STUB ONLY).
//
// LibreDTE (https://libredte.cl/) is the open-source self-hosted option.
// Free, but requires DevOps work (deploy your own DTE engine, manage CAFs
// locally, run the SII upload daemon). Worth considering once volume
// justifies eliminating per-DTE PSE fees.

import { SiiNotImplementedError } from './siiAdapter';
import type { DteRequest, DteResponse, SiiAdapter } from './types';

const LIBREDTE_DOCS_URL = 'https://docs.libredte.cl/';

export const libredteAdapter: SiiAdapter = {
  name: 'libredte',
  // LibreDTE is hosted by us — `isAvailable` checks for the self-hosted
  // base URL plus an API token (it ships with HTTP basic by default).
  isAvailable: Boolean(process.env.LIBREDTE_BASE_URL && process.env.LIBREDTE_TOKEN),
  async emitDte(_request: DteRequest): Promise<DteResponse> {
    throw new SiiNotImplementedError('emitDte', 'LibreDTE', LIBREDTE_DOCS_URL);
  },
  async getDteStatus(_trackId: string): Promise<DteResponse> {
    throw new SiiNotImplementedError('getDteStatus', 'LibreDTE', LIBREDTE_DOCS_URL);
  },
};
