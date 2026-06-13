import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { awardPoints as awardPointsServer, checkMedals as checkMedalsServer } from '../services/gamificationService';
import { isPointReason } from '../services/gamification/pointValues';
import confetti from 'canvas-confetti';

export interface UserStats {
  points: number;
  medals: string[];
  lastLogin: string;
  loginStreak: number;
  completedChallenges: Record<string, string>; // challenge name -> ISO date string
  displayName?: string;
  role?: string;
}

export function useGamification() {
  const { user } = useFirebase();
  const [stats, setStats] = useState<UserStats>({ points: 0, medals: [], lastLogin: '', loginStreak: 0, completedChallenges: {} });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setStats({ points: 0, medals: [], lastLogin: '', loginStreak: 0, completedChallenges: {} });
      setLoading(false);
      return;
    }

    const fetchStats = async () => {
      const docRef = doc(db, 'user_stats', user.uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data() as UserStats;
        
        // Ensure completedChallenges exists
        if (!data.completedChallenges) {
          data.completedChallenges = {};
        }
        
        // Check login streak
        const today = new Date().toISOString().split('T')[0];
        const lastLoginDate = data.lastLogin ? new Date(data.lastLogin).toISOString().split('T')[0] : '';
        
        let newStreak = data.loginStreak;
        if (lastLoginDate !== today) {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split('T')[0];
          
          if (lastLoginDate === yesterdayStr) {
            newStreak += 1;
          } else {
            newStreak = 1;
          }
          
          await updateDoc(docRef, {
            lastLogin: new Date().toISOString(),
            loginStreak: newStreak,
            displayName: user.displayName || user.email || 'Usuario'
          });
          data.loginStreak = newStreak;
        } else if (!data.displayName) {
          await updateDoc(docRef, {
            displayName: user.displayName || user.email || 'Usuario'
          });
        }
        
        setStats(data);
      } else {
        // Initialize stats. SECURITY (review #876): `role` is NOT written to
        // user_stats by the client — it is a privilege-escalation vector and is
        // rejected by firestore.rules. Role is sourced from the auth token /
        // `users/{uid}` (admin-provisioned); the leaderboard reads it server-side
        // via getLeaderboard() and the UI falls back to 'Usuario'.
        const initialStats: UserStats = {
          points: 0,
          medals: [],
          lastLogin: new Date().toISOString(),
          loginStreak: 1,
          completedChallenges: {},
          displayName: user.displayName || user.email || 'Usuario'
        };
        await setDoc(docRef, initialStats);
        setStats({ ...initialStats, role: 'Usuario' });
      }
      setLoading(false);
    };

    fetchStats();
  }, [user]);

  // XP is SERVER-AUTHORITATIVE (firestore.rules user_stats: the owner can no
  // longer write `points`/`medals`/`completedTrainings`/`safetyPosts` — a direct
  // client write now permission-denies). All point/medal awards must flow through
  // POST /api/gamification/points + /check-medals (Admin SDK, leaderboard-safe).
  // The server awards the canonical POINT_VALUES[reason] and ignores any amount,
  // so the legacy `amount` arg is advisory UI only. `reason` must be a whitelisted
  // PointReason for the award to persist; non-whitelisted reasons (in-app mini-
  // games without a canonical value) update the optimistic UI only.
  const addPoints = async (amount: number, reason: string) => {
    if (!user) return;
    if (isPointReason(reason)) {
      await awardPointsServer(reason); // server-authoritative; also fires medal check
    }
    setStats(prev => ({ ...prev, points: prev.points + amount }));
    // Here we could also trigger a toast notification for points earned
  };

  const unlockMedal = async (medalId: string) => {
    if (!user || stats.medals.includes(medalId)) return;
    // Medals are server-authoritative: ask the server to re-evaluate eligibility
    // (POST /api/gamification/check-medals re-derives medals from real stats and
    // writes them via the Admin SDK). The client cannot self-grant a medal.
    await checkMedalsServer();
    const newMedals = [...stats.medals, medalId];
    setStats(prev => ({ ...prev, medals: newMedals }));

    // Trigger confetti
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 1000 };

    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

    const interval: any = setInterval(function() {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);
      confetti({
        ...defaults, particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
      });
      confetti({
        ...defaults, particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
      });
    }, 250);
  };

  const completeChallenge = async (challengeId: string, points: number) => {
    if (!user) return;
    const now = new Date().toISOString();
    // `points` + `completedChallenges` are server-authoritative — persist via the
    // server award when the challenge maps to a whitelisted PointReason; otherwise
    // update the optimistic UI only (the legacy direct client write is forbidden
    // by firestore.rules). The server records completedChallenges[reason] itself.
    if (isPointReason(challengeId)) {
      await awardPointsServer(challengeId);
    }
    setStats(prev => ({
      ...prev,
      points: prev.points + points,
      completedChallenges: {
        ...prev.completedChallenges,
        [challengeId]: now
      }
    }));
  };

  return { stats, addPoints, unlockMedal, completeChallenge, loading };
}
