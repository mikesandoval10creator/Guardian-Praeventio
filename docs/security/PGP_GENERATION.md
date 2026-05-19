# PGP key para `/.well-known/pgp-key.asc`

> **Estado** (2026-05-19): placeholder activo. TODO.md §12.10.3 lo lista
> como pendiente bloqueado por input usuario.

## Por qué

`security.txt` (RFC 9116) referencia esta URL como canal de encryption
para que investigadores envíen reports de vulnerabilidad de forma
confidencial. Sin la key real:
- Auditores SOC 2 reportan el archivo como gap (PI4: Security
  Configuration Standards).
- Bug-bounty platforms (HackerOne / Bugcrowd) requieren PGP funcional.
- Investigadores responsables no pueden enviar PoC con CVE-style
  privacy.

## Cómo generar (el usuario, una sola vez)

Estos pasos requieren **input del usuario** porque la passphrase
privada de la key nunca debe tocar este repo ni infra del agente.

```bash
# 1. Generar par RSA 4096 con expiración 2 años
gpg --quick-generate-key "Praeventio Guard Security <contacto@praeventio.net>" \
    rsa4096 sign,encr 2y

# 2. Verificar fingerprint generado
gpg --fingerprint contacto@praeventio.net
# Ejemplo de fingerprint: ABCD 1234 ... (40 hex chars)

# 3. Exportar la public key (ASCII-armored)
gpg --armor --export contacto@praeventio.net > public/.well-known/pgp-key.asc

# 4. Backup de la private key en una bóveda offline (NUNCA al repo)
gpg --armor --export-secret-keys contacto@praeventio.net > ~/praeventio-pgp-private.asc
# Guardar este archivo en bóveda fría (USB encriptado + caja fuerte
# física). Eliminar el archivo en disco después de transferir.

# 5. Actualizar security.txt (descomenta la línea Encryption)
sed -i 's|^# Encryption:|Encryption:|' public/.well-known/security.txt
# El URL queda: Encryption: https://praeventio.net/.well-known/pgp-key.asc

# 6. Commit + push solo el public key + security.txt
git add public/.well-known/pgp-key.asc public/.well-known/security.txt
git commit -m "security: publicar PGP public key para vuln disclosure"
git push
```

## Rotación

- **Expiración**: 2 años (configurable). 30 días antes del expiry,
  regenerar siguiendo los pasos arriba con nueva expiry date.
- **Revocación**: si la private key se compromete, generar revocation
  certificate inmediato:
  ```bash
  gpg --output revoke.asc --gen-revoke contacto@praeventio.net
  # Distribuir revoke.asc públicamente.
  ```

## Verificación post-deploy

```bash
# Curl la public key del prod
curl https://praeventio.app/.well-known/pgp-key.asc | gpg --import-options show-only --import

# El output debe mostrar fingerprint válido + expiry + uid
# "Praeventio Guard Security <contacto@praeventio.net>"
```

## Política de uso

- Vulnerabilidades **deben** encriptarse a esta key antes de enviar
  a `contacto@praeventio.net`.
- El equipo de seguridad **debe** rotar el key cada 24 meses o tras
  cualquier compromiso sospechoso.
- La private key **NUNCA** se versiona en este repo ni se sube a
  Cloud Run / Firebase secrets. Vive offline.
