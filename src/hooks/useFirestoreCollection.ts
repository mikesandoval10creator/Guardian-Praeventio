import { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  DocumentData,
  QueryConstraint
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { usePendingActions } from './usePendingActions';

export function useFirestoreCollection<T = DocumentData>(
  collectionPath: string | null | undefined,
  constraints: QueryConstraint[] = []
) {
  const [fetchedData, setFetchedData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Only fetch pending actions if we have a valid collection path
  const pendingActions = usePendingActions(collectionPath || '');

  useEffect(() => {
    if (!collectionPath) {
      setFetchedData([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const colRef = collection(db, collectionPath);
    const q = query(colRef, ...constraints);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) => {
          const data = doc.data();
          if (collectionPath === 'nodes' || collectionPath.includes('/nodes')) {
            if (data.content && !data.description) {
              data.description = data.content;
            }
          }
          return {
            id: doc.id,
            ...data,
          };
        }) as T[];
        setFetchedData(items);
        setLoading(false);
      },
      (err) => {
        console.error(`Error fetching collection ${collectionPath}:`, err);
        setError(err as Error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [collectionPath, JSON.stringify(constraints)]);

  const data = useMemo(() => {
    let combined = [...fetchedData];
    
    pendingActions.forEach(action => {
      if (action.type === 'update' && action.data.id) {
        const index = combined.findIndex((item: any) => item.id === action.data.id);
        if (index !== -1) {
          combined[index] = { ...combined[index], ...action.data };
        }
      } else if (action.type === 'delete' && action.data.id) {
        combined = combined.filter((item: any) => item.id !== action.data.id);
      }
    });
    
    const pendingCreates = pendingActions
      .filter(a => a.type === 'create' || a.type === 'upload')
      .map(a => ({
        ...(a.type === 'upload' ? a.data.documentData : a.data),
        id: `pending-${a.id}`,
        isPendingSync: true
      })) as T[];
      
    return [...pendingCreates, ...combined];
  }, [fetchedData, pendingActions]);

  return { data, loading, error };
}
