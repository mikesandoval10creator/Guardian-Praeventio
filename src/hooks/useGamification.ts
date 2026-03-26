import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useFirebase } from '../contexts/FirebaseContext';
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
            displayName: user.displayName || user.email || 'Usuario',
            role: data.role || 'Usuario'
          });
          data.loginStreak = newStreak;
        } else if (!data.displayName) {
          await updateDoc(docRef, {
            displayName: user.displayName || user.email || 'Usuario',
            role: data.role || 'Usuario'
          });
        }
        
        setStats(data);
      } else {
        // Initialize stats
        const initialStats: UserStats = {
          points: 0,
          medals: [],
          lastLogin: new Date().toISOString(),
          loginStreak: 1,
          completedChallenges: {},
          displayName: user.displayName || user.email || 'Usuario',
          role: 'Usuario'
        };
        await setDoc(docRef, initialStats);
        setStats(initialStats);
      }
      setLoading(false);
    };

    fetchStats();
  }, [user]);

  const addPoints = async (amount: number, reason: string) => {
    if (!user) return;
    const docRef = doc(db, 'user_stats', user.uid);
    await updateDoc(docRef, {
      points: increment(amount)
    });
    setStats(prev => ({ ...prev, points: prev.points + amount }));
    // Here we could also trigger a toast notification for points earned
  };

  const unlockMedal = async (medalId: string) => {
    if (!user || stats.medals.includes(medalId)) return;
    const docRef = doc(db, 'user_stats', user.uid);
    const newMedals = [...stats.medals, medalId];
    await updateDoc(docRef, {
      medals: newMedals
    });
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
    const docRef = doc(db, 'user_stats', user.uid);
    const now = new Date().toISOString();
    
    await updateDoc(docRef, {
      [`completedChallenges.${challengeId}`]: now,
      points: increment(points)
    });
    
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
