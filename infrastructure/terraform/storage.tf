# =============================================================================
# Praeventio Guard — GCS backups bucket
# =============================================================================
#
# Stores Firestore export artifacts written by the nightly Cloud Run job
# (scripts/backup-firestore.cjs). Lifecycle: STANDARD → NEARLINE at 30d,
# DELETE at 365d. Object versioning is ON so a misbehaving job that overwrites
# an export does not nuke the previous good copy.
#
# Reviewer note (last round): we should split the bucket into a separate
# billing project to survive a project-level billing suspension. That cross-
# project move is non-trivial in Terraform and is tracked in DR_RUNBOOK.md §4.4.
# For now the bucket lives in the application project.
#
# Docs:
#   https://cloud.google.com/storage/docs/lifecycle
#   https://cloud.google.com/storage/docs/bucket-lock
# =============================================================================

locals {
  backups_bucket_name = coalesce(
    var.backups_bucket_name_override,
    "${var.project_id}-backups",
  )
}

resource "google_storage_bucket" "backups" {
  name     = local.backups_bucket_name
  location = var.region

  # Recommended modern defaults.
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Versioning catches accidental overwrites of an export folder.
  versioning {
    enabled = true
  }

  # STANDARD → NEARLINE at 30d. Cheaper after the first month.
  lifecycle_rule {
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
    condition {
      age = var.backups_nearline_after_days
    }
  }

  # Hard delete at 365d.
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = var.backups_retention_days
    }
  }

  # Bucket-level retention policy. Once an object is written it cannot be
  # deleted for at least retention_period seconds, even by an admin. This is
  # the regulatory ankle that distinguishes "lifecycle delete after a year" from
  # "ransomware operator with stolen creds wipes the bucket on day 1".
  retention_policy {
    retention_period = var.backups_min_retention_seconds
    is_locked        = false # set true only after retention is confirmed correct — locking is irreversible
  }

  labels = var.labels

  lifecycle {
    prevent_destroy = true
  }
}

# -----------------------------------------------------------------------------
# Bucket-scoped IAM. Granting at the bucket level (not project level) so the
# firestore-backup SA cannot read the rest of the project's storage.
# -----------------------------------------------------------------------------
resource "google_storage_bucket_iam_member" "firestore_backup_object_admin" {
  bucket = google_storage_bucket.backups.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.firestore_backup.email}"
}
