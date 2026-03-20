import { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  DocumentData,
  QueryConstraint
} from 'firebase/firestore';
import { db } from '../services/firebase';

export function useFirestoreCollection<T = DocumentData>(
  collectionPath: string,
  constraints: QueryConstraint[] = []
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setLoading(true);
    const colRef = collection(db, collectionPath);
    const q = query(colRef, ...constraints);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as T[];
        setData(items);
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

  return { data, loading, error };
}
