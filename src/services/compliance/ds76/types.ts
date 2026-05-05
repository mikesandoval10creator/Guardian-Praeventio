// Praeventio Guard — Sprint 31 Bucket PP.
//
// DS 76/2007 (MINTRAB) types. The decree mandates the principal
// contractor (mandante) and every subcontractor in mining/construction
// to maintain a "Reglamento Especial para Empresas Contratistas y
// Subcontratistas" + a SST management system. Required artifacts include
// the Plan de Gestión SST, supervision plan, training matrix, and the
// SUSESO fiscalización record.
//
// Folio shape: `DS76-${year}-${slug}-${seq:06d}`.

export interface Ds76Signature {
  signerUid: string;
  signerRut: string;
  signedAt: string;
  algorithm: 'webauthn-ecdsa-p256' | 'kms-sign-rsa';
  signatureB64: string;
  payloadHashHex: string;
}

export interface Ds76Form {
  folio: string;

  // Identificación
  tenantId: string;
  // Empresa principal (mandante)
  principalCompanyName: string;
  principalCompanyRut: string;
  // Empresa contratista o subcontratista
  contractorCompanyName: string;
  contractorCompanyRut: string;
  // Faena
  worksiteName: string;
  worksiteAddress: string;

  // Section 1 — Plan de Gestión SST.
  sstManagementPlan: string;
  // Section 2 — Sistema de gestión (texto + matriz, opcional).
  managementSystemDescription: string;
  // Section 3 — Supervisión.
  supervisionScheme: string;
  // Section 4 — Capacitación: lista de cursos + horas.
  trainingItems: Array<{ topic: string; hours: number }>;
  // Section 5 — Registro de fiscalización SUSESO.
  susesoFiscalizationRecord: string;

  // Audit
  createdAt: string;
  signature?: Ds76Signature;
}
