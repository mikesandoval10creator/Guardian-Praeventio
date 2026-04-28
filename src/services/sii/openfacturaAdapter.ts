// Praeventio Guard — OpenFactura PSE adapter (STUB ONLY).
//
// OpenFactura (https://www.openfactura.cl/) is a SaaS PSE spun out of
// libredte.cl. REST API, well-documented, monthly pricing.
//
// SCAFFOLDING ONLY. No SDK or REST client is installed; both methods throw
// `SiiNotImplementedError` with the docs URL so the exception message is
// actionable. Replace this body in Round 2 once the PSE is picked.
//
// Wiring contract (when implemented):
//   • Read `OPENFACTURA_API_KEY` (and optionally `OPENFACTURA_API_BASE_URL`
//     for sandbox vs. production).
//   • POST `${baseUrl}/v1/dte` with the Praeventio→OpenFactura DTE payload.
//   • Map OpenFactura's response shape to our `DteResponse`:
//       folio          ← `data.folio`
//       trackId        ← `data.trackId`
//       status         ← map `data.estado` ('aceptado' | 'rechazado' | 'pendiente')
//       pdfUrl         ← `data.pdfUrl`
//       xml            ← optional, fetched separately via `/v1/dte/{folio}/xml`.
//   • For `getDteStatus(trackId)`, GET `${baseUrl}/v1/dte/track/${trackId}`.

import { SiiNotImplementedError } from './siiAdapter';
import type { DteRequest, DteResponse, SiiAdapter } from './types';

const OPENFACTURA_DOCS_URL = 'https://www.openfactura.cl/docs';

export const openfacturaAdapter: SiiAdapter = {
  name: 'openfactura',
  // Truthy when a key is present in the env. We do NOT validate the key
  // here; any malformed value would surface at first call as a 401.
  isAvailable: Boolean(process.env.OPENFACTURA_API_KEY),
  async emitDte(_request: DteRequest): Promise<DteResponse> {
    throw new SiiNotImplementedError('emitDte', 'OpenFactura', OPENFACTURA_DOCS_URL);
  },
  async getDteStatus(_trackId: string): Promise<DteResponse> {
    throw new SiiNotImplementedError('getDteStatus', 'OpenFactura', OPENFACTURA_DOCS_URL);
  },
};
