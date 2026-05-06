// SPDX-License-Identifier: MIT
//
// Sprint 33 — Network status helper (ADR 0013 mesh fallback wire W10).
//
// El detector de emergencia (`emergency/autoTrigger`) puede dispararse en
// un device sin red mobile (túnel minero LATAM, faena rural, sótano).
// Antes de delegar al mesh, necesitamos una respuesta sí/no rápida sobre
// si vale la pena intentar el server fan-out o saltar directo al
// rebroadcast por BLE/WiFi Direct.
//
// `navigator.onLine` no es 100% confiable (false-negatives en redes
// "captive portal" y false-positives en LTE moribunda), pero es la mejor
// señal disponible sin pegarle a un endpoint cada vez. Para SSR/Node
// (tests, server bundles) asumimos true (online) — el server-side ya
// tiene red por definición.

export function isOnline(): boolean {
  // SSR / Node test runtime: navigator no existe → asumimos online.
  if (typeof navigator === 'undefined') return true;
  // `onLine` es opcional en la spec; cuando no está, asumimos online
  // para no degradar UX.
  if (typeof navigator.onLine !== 'boolean') return true;
  return navigator.onLine;
}
