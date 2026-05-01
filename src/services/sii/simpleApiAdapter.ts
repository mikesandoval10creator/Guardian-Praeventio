// Praeventio Guard — SimpleAPI PSE adapter (STUB ONLY).
//
// SimpleAPI (https://www.simpleapi.cl/) is a Chilean fintech, REST-first,
// per-DTE pricing, modern webhook ecosystem.
//
// SCAFFOLDING ONLY. No SDK or REST client is installed; both methods throw
// `SiiNotImplementedError` with the docs URL.
//
// Wiring contract (when implemented):
//   • Read `SIMPLEAPI_API_KEY` (and `SIMPLEAPI_API_BASE_URL` for sandbox).
//   • POST `${baseUrl}/dte/issue` with the SimpleAPI-flavored payload.
//   • Map their response shape to our `DteResponse`:
//       folio          ← `result.folio`
//       trackId        ← `result.trackingId`
//       status         ← map `result.status`
//                        ('ACCEPTED' | 'REJECTED' | 'PENDING') → lowercase
//       pdfUrl         ← `result.pdfUrl`
//   • SimpleAPI offers webhook callbacks for SII outcome — register
//     `/api/billing/sii/webhook` and validate the HMAC signature header.

import { SiiNotImplementedError } from './siiAdapter';
import type { DteRequest, DteResponse, SiiAdapter } from './types';

const SIMPLEAPI_DOCS_URL = 'https://docs.simpleapi.cl/';

export const simpleApiAdapter: SiiAdapter = {
  name: 'simpleapi',
  isAvailable: Boolean(process.env.SIMPLEAPI_API_KEY),
  async emitDte(_request: DteRequest): Promise<DteResponse> {
    throw new SiiNotImplementedError('emitDte', 'SimpleAPI', SIMPLEAPI_DOCS_URL);
  },
  async getDteStatus(_trackId: string): Promise<DteResponse> {
    throw new SiiNotImplementedError('getDteStatus', 'SimpleAPI', SIMPLEAPI_DOCS_URL);
  },
};
