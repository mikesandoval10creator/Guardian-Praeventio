# =============================================================================
# Praeventio Guard — Terraform + provider version pinning
# =============================================================================
#
# Pin Terraform CLI and the Google provider to deterministic versions so that
# `terraform plan` produces stable output across CI runs and developer machines.
#
# Provider release notes:
#   https://github.com/hashicorp/terraform-provider-google/releases
# Terraform release notes:
#   https://github.com/hashicorp/terraform/releases
#
# When bumping the google provider major version, re-read the upgrade guide:
#   https://registry.terraform.io/providers/hashicorp/google/latest/docs/guides/version_5_upgrade
# =============================================================================

terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }

    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }

    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
