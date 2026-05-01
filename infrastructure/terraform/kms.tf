# =============================================================================
# Praeventio Guard — Cloud KMS
# =============================================================================
#
# OAuth refresh tokens are stored in Firestore wrapped with envelope encryption.
# The Key Encryption Key (KEK) lives here in Cloud KMS; the wrapped DEKs travel
# inside Firestore documents.
#
# See:
#   https://cloud.google.com/kms/docs/envelope-encryption
#   src/server/services/kmsEnvelope.ts
#   docs/KMS_ROTATION.md
# =============================================================================

resource "google_kms_key_ring" "praeventio" {
  name     = "praeventio"
  location = var.region

  lifecycle {
    # Key rings cannot be deleted in GCP at all (only individual versions can be
    # destroyed). prevent_destroy is belt-and-suspenders against accidental
    # `terraform destroy` removing it from state.
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key" "oauth_tokens_kek" {
  name     = "oauth-tokens-kek"
  key_ring = google_kms_key_ring.praeventio.id
  purpose  = "ENCRYPT_DECRYPT"

  # 90-day automatic rotation. Existing wrapped DEKs continue to decrypt with
  # the version that wrapped them; new encrypts use the primary version.
  # https://cloud.google.com/kms/docs/key-rotation
  rotation_period = var.kms_key_rotation_period

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "SOFTWARE"
  }

  labels = var.labels

  lifecycle {
    # Destroying this key would brick every encrypted OAuth refresh token in
    # Firestore. Removal must be a manual, audited operation.
    prevent_destroy = true
  }
}

# -----------------------------------------------------------------------------
# IAM — only the app runtime SA can encrypt/decrypt with the OAuth KEK.
# Granted at the key level (NOT project level) per principle of least privilege.
# -----------------------------------------------------------------------------
resource "google_kms_crypto_key_iam_member" "app_runtime_encrypter" {
  crypto_key_id = google_kms_crypto_key.oauth_tokens_kek.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.app_runtime.email}"
}

# Dedicated SA used by one-off migration scripts (see scripts/migrate-oauth-
# tokens-to-envelope.cjs). Not strictly required for steady-state operation.
resource "google_kms_crypto_key_iam_member" "kms_encrypter_only" {
  crypto_key_id = google_kms_crypto_key.oauth_tokens_kek.id
  role          = "roles/cloudkms.cryptoKeyEncrypter"
  member        = "serviceAccount:${google_service_account.kms_encrypter.email}"
}
