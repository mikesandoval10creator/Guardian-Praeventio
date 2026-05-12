// Persistence #17: lessons library adapter.
// Schema: tenants/{tid}/lessons/{id}
// Indexes: (scope, publishedAt desc), (industry, publishedAt desc),
//          (riskCategories ARRAY_CONTAINS, adoptionCount desc)

import type { Lesson, LessonScope } from './lessonsLibrary.js';

export interface LessonsFirestoreDb {
  collection(path: string): any;
}

const PATH = (tid: string) => `tenants/${tid}/lessons`;

export class LessonsAdapter {
  constructor(
    private readonly db: LessonsFirestoreDb,
    private readonly tenantId: string,
  ) {}

  async save(lesson: Lesson): Promise<void> {
    await this.db.collection(PATH(this.tenantId)).doc(lesson.id).set(lesson);
  }

  async getById(id: string): Promise<Lesson | null> {
    const snap = await this.db.collection(PATH(this.tenantId)).doc(id).get();
    return snap.exists ? (snap.data() as Lesson) : null;
  }

  async incrementAdoption(id: string): Promise<Lesson | null> {
    const ref = this.db.collection(PATH(this.tenantId)).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const current = snap.data() as Lesson;
    const updated: Lesson = { ...current, adoptionCount: current.adoptionCount + 1 };
    await ref.set(updated);
    return updated;
  }

  async listByScope(scope: LessonScope, limitN = 100): Promise<Lesson[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId))
      .where('scope', '==', scope)
      .orderBy('publishedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as Lesson);
  }

  async listByRiskCategory(riskCategory: string, limitN = 50): Promise<Lesson[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId))
      .where('riskCategories', 'array-contains', riskCategory)
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as Lesson);
  }

  async listTopAdopted(limitN = 10): Promise<Lesson[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId))
      .orderBy('adoptionCount', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as Lesson);
  }
}
