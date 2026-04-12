import { collection, getDocs, doc, setDoc, addDoc } from 'firebase/firestore';
import { db } from './firebase';
import { INDUSTRY_IPER_BASE } from '../data/industryIPER';
import { NodeType } from '../types';

export const seedCommunityGlossary = async () => {
  try {
    console.log('Iniciando poblamiento del Grand Line (Community Glossary)...');
    const response = await fetch('/api/seed-glossary', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Error: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Poblamiento completado:', data);
    return data;
  } catch (error) {
    console.error('Error seeding community glossary:', error);
    throw error;
  }
};

export const seedGlobalData = async (projectId?: string, industry?: string) => {
  try {
    // 1. Seed Industry IPER Templates (Global)
    const templatesRef = collection(db, 'global_templates');
    const templatesSnapshot = await getDocs(templatesRef);
    
    if (templatesSnapshot.empty) {
      console.log('Seeding global templates...');
      for (const [industryName, nodes] of Object.entries(INDUSTRY_IPER_BASE)) {
        await setDoc(doc(templatesRef, industryName.replace(/[^a-zA-Z0-9]/g, '_')), {
          industryName: industryName,
          nodes: nodes
        });
      }
      console.log('Global templates seeded successfully.');
    }

    // 2. Seed Project-Specific IPER Nodes if projectId is provided
    if (projectId && industry) {
      console.log(`Seeding IPER nodes for project ${projectId} (${industry})...`);
      const nodesToSeed = INDUSTRY_IPER_BASE[industry] || INDUSTRY_IPER_BASE['General'];
      const nodesRef = collection(db, 'nodes');

      for (const baseNode of nodesToSeed) {
        await addDoc(nodesRef, {
          type: NodeType.RISK,
          title: baseNode.title,
          description: `Peligro: ${baseNode.description}\nRiesgo: ${baseNode.riesgo}\nConsecuencia: ${baseNode.consecuencia}`,
          tags: baseNode.tags,
          projectId: projectId,
          metadata: {
            actividad: baseNode.actividad,
            probabilidad: baseNode.probabilidad,
            severidad: baseNode.severidad,
            riesgoPuro: baseNode.probabilidad * baseNode.severidad,
            controles: baseNode.controles
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      console.log('Project IPER nodes seeded successfully.');
    }

    // 3. Seed Gamification Games
    const gamesRef = collection(db, 'gamification_content');
    const gamesSnapshot = await getDocs(gamesRef);
    
    if (gamesSnapshot.empty) {
      console.log('Seeding gamification content...');
      const games = [
        {
          id: 'g1',
          title: 'Buscando al Guardián',
          description: 'Encuentra al Guardián Praeventio (casco blanco, lentes verdes) y 3 extintores ocultos en la faena.',
          thumbnail: 'https://images.unsplash.com/photo-1541888086425-d81bb19240f5?auto=format&fit=crop&q=80&w=800',
          fallbackThumbnail: 'https://images.unsplash.com/photo-1541888086425-d81bb19240f5?auto=format&fit=crop&q=80&w=800',
          points: 100,
          requiredPoints: 0,
          type: 'find_objects',
          objectsToFind: ['Guardián Praeventio', 'Extintor 1', 'Extintor 2', 'Extintor 3']
        },
        {
          id: 'g2',
          title: 'La Garra del EPP',
          description: 'Identifica al trabajador que no está usando el EPP correcto.',
          thumbnail: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&q=80&w=800',
          fallbackThumbnail: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&q=80&w=800',
          points: 100,
          requiredPoints: 100,
          type: 'identify_risk'
        },
        {
          id: 'g3',
          title: 'Simulador de Extintores',
          description: 'Identifica el riesgo de incendio en la imagen.',
          thumbnail: 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?auto=format&fit=crop&q=80&w=800',
          fallbackThumbnail: 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?auto=format&fit=crop&q=80&w=800',
          points: 150,
          requiredPoints: 200,
          type: 'simulator'
        }
      ];

      for (const game of games) {
        await setDoc(doc(gamesRef, game.id), game);
      }
      console.log('Gamification content seeded successfully.');
    }
  } catch (error) {
    console.error('Error seeding global data:', error);
  }
};
