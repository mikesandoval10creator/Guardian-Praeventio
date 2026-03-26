import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { db, collection, onSnapshot, query, where, handleFirestoreError, OperationType } from '../services/firebase';
import { useFirebase } from './FirebaseContext';

interface Project {
  id: string;
  name: string;
  description: string;
  location: string;
  coordinates?: { lat: number; lng: number };
  industry: string;
  status: 'active' | 'completed' | 'archived';
  startDate: string;
  endDate?: string;
  clientName?: string;
  riskLevel: 'Bajo' | 'Medio' | 'Alto' | 'Crítico';
}

interface ProjectContextType {
  projects: Project[];
  selectedProject: Project | null;
  setSelectedProject: (project: Project | null) => void;
  createProject: (project: Omit<Project, 'id'>) => Promise<string>;
  loading: boolean;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const { isAuthReady, user, isAdmin } = useFirebase();

  const createProject = async (projectData: Omit<Project, 'id'>): Promise<string> => {
    try {
      const { addDoc } = await import('firebase/firestore');
      const docRef = await addDoc(collection(db, 'projects'), {
        ...projectData,
        createdAt: new Date().toISOString(),
        createdBy: user?.uid,
        members: [user?.uid]
      });
      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'projects');
      throw error;
    }
  };

  useEffect(() => {
    if (!isAuthReady || !user) {
      setProjects([]);
      setSelectedProject(null);
      setLoading(false);
      return;
    }

    // For now, let everyone see all projects to avoid complex member management
    const q = query(collection(db, 'projects'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newProjects = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Project[];
      
      setProjects(newProjects);
      
      // Auto-select first project if none selected
      if (newProjects.length > 0 && !selectedProject) {
        setSelectedProject(newProjects[0]);
      }
      
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'projects');
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  return (
    <ProjectContext.Provider value={{ projects, selectedProject, setSelectedProject, createProject, loading }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}
