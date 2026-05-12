// Persistence #9: faenaOnboardingBundle adapter.
// Schema: tenants/{tid}/onboarding_bundles/{id}
// Indexes: (workerUid, status), (status, updatedAt desc), (projectId, status)

import type { OnboardingBundle, OnboardingStatus } from './faenaOnboardingBundle.js';

export interface OnboardingFirestoreDb {
  collection(path: string): any;
}

const PATH = (tid: string) => `tenants/${tid}/onboarding_bundles`;

export class FaenaOnboardingAdapter {
  constructor(
    private readonly db: OnboardingFirestoreDb,
    private readonly tenantId: string,
  ) {}

  async save(bundle: OnboardingBundle): Promise<void> {
    await this.db.collection(PATH(this.tenantId)).doc(bundle.id).set(bundle);
  }

  async getById(id: string): Promise<OnboardingBundle | null> {
    const snap = await this.db.collection(PATH(this.tenantId)).doc(id).get();
    return snap.exists ? (snap.data() as OnboardingBundle) : null;
  }

  async updateStatus(id: string, status: OnboardingStatus, updatedAt: string): Promise<void> {
    await this.db.collection(PATH(this.tenantId)).doc(id).update({ status, updatedAt });
  }

  async recordReview(
    id: string,
    reviewerUid: string,
    reviewedAt: string,
    reviewerNotes: string | undefined,
    status: OnboardingStatus,
  ): Promise<void> {
    await this.db
      .collection(PATH(this.tenantId))
      .doc(id)
      .update({ reviewerUid, reviewedAt, reviewerNotes, status, updatedAt: reviewedAt });
  }

  async listForWorker(workerUid: string, limitN = 20): Promise<OnboardingBundle[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId))
      .where('workerUid', '==', workerUid)
      .orderBy('updatedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as OnboardingBundle);
  }

  async listByStatus(status: OnboardingStatus, limitN = 100): Promise<OnboardingBundle[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId))
      .where('status', '==', status)
      .orderBy('updatedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as OnboardingBundle);
  }

  async listForProject(projectId: string, limitN = 100): Promise<OnboardingBundle[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId))
      .where('projectId', '==', projectId)
      .orderBy('updatedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as OnboardingBundle);
  }
}
