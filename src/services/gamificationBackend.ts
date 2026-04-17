import * as admin from 'firebase-admin';

export const awardPoints = async (uid: string, amount: number, reason: string) => {
  const db = admin.firestore();
  const userRef = db.collection('user_stats').doc(uid);
  
  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(userRef);
    if (!doc.exists) {
      transaction.set(userRef, {
        points: amount,
        medals: [],
        lastLogin: new Date().toISOString(),
        loginStreak: 1,
        completedChallenges: { [reason]: new Date().toISOString() },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      transaction.update(userRef, {
        points: admin.firestore.FieldValue.increment(amount),
        [`completedChallenges.${reason}`]: new Date().toISOString()
      });
    }
    
    // Log finding
    transaction.set(db.collection('gamification_history').doc(), {
      uid,
      amount,
      reason,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  });
};

export const getLeaderboard = async (limit: number = 10) => {
  const db = admin.firestore();
  const snapshot = await db.collection('user_stats')
    .orderBy('points', 'desc')
    .limit(limit)
    .get();
    
  return snapshot.docs.map(doc => ({
    uid: doc.id,
    ...doc.data()
  }));
};

export const checkMedalEligibility = async (uid: string) => {
  const db = admin.firestore();
  const userStats = await db.collection('user_stats').doc(uid).get();
  const stats = userStats.data();
  if (!stats) return [];

  const newMedals: string[] = [];
  
  // Logic: "Guardia Iniciado" for > 150 points
  if (stats.points >= 150 && !stats.medals.includes('guardian-iniciado')) {
    newMedals.push('guardian-iniciado');
  }
  
  // Logic: "Racha Activa" for 7 day streak
  if (stats.loginStreak >= 7 && !stats.medals.includes('racha-7-dias')) {
    newMedals.push('racha-7-dias');
  }

  if (newMedals.length > 0) {
    await db.collection('user_stats').doc(uid).update({
      medals: admin.firestore.FieldValue.arrayUnion(...newMedals)
    });
  }

  return newMedals;
};
