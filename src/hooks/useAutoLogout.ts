import { useEffect, useRef } from 'react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useNavigate } from 'react-router-dom';
import { logOut } from '../services/firebase';

const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes

export function useAutoLogout() {
  const { user } = useFirebase();
  const navigate = useNavigate();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimeout = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (user) {
      timeoutRef.current = setTimeout(async () => {
        try {
          await logOut();
          navigate('/login');
          // Optional: Show a toast notification here
          console.log('Sesión cerrada por inactividad');
        } catch (error) {
          console.error('Error auto-logging out:', error);
        }
      }, INACTIVITY_TIMEOUT);
    }
  };

  useEffect(() => {
    if (!user) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      return;
    }

    // Events that reset the inactivity timer
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];

    const handleActivity = () => {
      resetTimeout();
    };

    // Initial setup
    resetTimeout();

    // Add event listeners
    events.forEach(event => {
      window.addEventListener(event, handleActivity);
    });

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [user, navigate]);
}
