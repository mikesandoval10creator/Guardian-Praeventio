# Política de Divulgación Responsable / Responsible Disclosure Policy

Praeventio Guard es una aplicación de prevención de riesgos laborales
usada por trabajadores en faena. Una vulnerabilidad podría comprometer
datos sensibles (médicos, biométricos, ubicación) o, peor, impedir que
una alarma de "Hombre Caído" o "Botón SOS" funcione cuando una vida
depende de ella.

Por eso tomamos los reportes de seguridad muy en serio.

## Si encuentras una vulnerabilidad

**No la publiques.** Reporta privadamente a:

📧 **security@praeventio.net** (PGP key: [link a key]; fingerprint: [TBD])

Incluye:
1. Descripción de la vulnerabilidad
2. Pasos para reproducirla (si aplica)
3. Impacto que crees que tiene
4. Si tienes prueba de concepto, adjúntala
5. Tu nombre / handle / preferred pronoun para crédito (opcional)

## Qué prometemos

| Tiempo desde tu reporte | Lo que harás | Lo que haremos |
|---|---|---|
| 0–24 horas | nada | acuse de recibo |
| 24–72 horas | esperar | triage inicial + severidad asignada |
| 72 horas – 30 días | (puedes hacer follow-up) | fix + patch deployment + comunicación |
| 30+ días | si crítico, considera disclosure coordinado | postmortem público |

## Severidades

Ver [docs/security/severity-rubric.md](./docs/security/severity-rubric.md).

## Scope

**In scope:**
- praeventio.net + subdomains
- app.praeventio.net (la app)
- API endpoints (/api/*)
- Apps móviles (Android Play Store, iOS App Store)
- Cualquier código en este repo (https://github.com/mikesandoval10creator/Guardian-Praeventio)

**Out of scope:**
- Infraestructura de proveedores (Google Cloud, Firebase, Transbank, OpenWeather)
  — repórtalos a ellos directamente
- Vulnerabilidades en dependencias upstream — usa npm audit + ecosistema npm
- Phishing / ingeniería social fuera de la aplicación
- DoS / DDoS sin demostración de impacto en producción

## No haremos

- No te demandaremos por hacer este trabajo
- No te bloquearemos cuentas
- No te llamaremos a la policía si actúas dentro del scope

## Bug bounty

Praeventio Guard es una empresa SaaS naciente sin programa formal de bug bounty
todavía. Cuando lleguemos a 100+ clientes Empresarial, lanzaremos uno via
HackerOne o equivalente. Mientras tanto:
- Reconocimiento público en este SECURITY.md (Hall of Fame, abajo)
- Carta de agradecimiento + LinkedIn endorsement
- Para vulnerabilidades de severidad CRITICAL, podemos negociar una recompensa caso por caso

## Hall of Fame

(Sin reportes todavía. Sé tú el primero.)

---
*Documento actualizado: 2026-04-28*
