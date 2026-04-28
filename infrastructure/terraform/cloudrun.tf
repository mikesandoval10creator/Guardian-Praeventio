# =============================================================================
# Praeventio Guard — Cloud Run jobs
# =============================================================================
#
# Two jobs, both built from the same image (Dockerfile in repo root). The
# scheduler (scheduler.tf) hits the Cloud Run jobs v2 API to invoke them.
#
# We use google_cloud_run_v2_job (not the deprecated v1 namespaces API). The
# previous round flagged the v1 URL as a smell — both the resource and the
# scheduler URI now use v2.
#
# Docs:
#   https://cloud.google.com/run/docs/create-jobs
#   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_job
# =============================================================================

locals {
  backup_image = coalesce(
    var.backup_image,
    "gcr.io/${var.project_id}/firestore-backup:latest",
  )
}

# -----------------------------------------------------------------------------
# Nightly Firestore export.
# -----------------------------------------------------------------------------
resource "google_cloud_run_v2_job" "firestore_nightly_backup" {
  name     = "firestore-nightly-backup"
  location = var.region

  template {
    template {
      service_account = google_service_account.firestore_backup.email
      timeout         = "${var.backup_job_timeout_seconds}s"
      max_retries     = 1 # do NOT retry — partial export already lives in GCS, just alarm

      containers {
        image   = local.backup_image
        command = ["node"]
        args    = ["scripts/backup-firestore.cjs"]

        env {
          name  = "GCP_PROJECT_ID"
          value = var.project_id
        }
        env {
          name  = "GCS_BACKUP_BUCKET"
          value = "gs://${google_storage_bucket.backups.name}"
        }
        env {
          name  = "NODE_ENV"
          value = "production"
        }
      }
    }
  }

  labels = var.labels

  lifecycle {
    ignore_changes = [
      # The CI/CD pipeline overwrites the image tag on each deploy; Terraform
      # should not flap on that diff.
      template[0].template[0].containers[0].image,
    ]
  }
}

# -----------------------------------------------------------------------------
# Weekly integrity check.
# -----------------------------------------------------------------------------
resource "google_cloud_run_v2_job" "firestore_backup_integrity_check" {
  name     = "firestore-backup-integrity-check"
  location = var.region

  template {
    template {
      service_account = google_service_account.firestore_backup.email
      timeout         = "${var.integrity_job_timeout_seconds}s"
      max_retries     = 1

      containers {
        image   = local.backup_image
        command = ["node"]
        args    = ["scripts/test-backup-integrity.cjs"]

        env {
          name  = "GCP_PROJECT_ID"
          value = var.project_id
        }
        env {
          name  = "GCS_BACKUP_BUCKET"
          value = "gs://${google_storage_bucket.backups.name}"
        }
        env {
          name  = "BACKUP_MAX_AGE_HOURS"
          value = "30"
        }
      }
    }
  }

  labels = var.labels

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
    ]
  }
}
