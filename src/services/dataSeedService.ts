import admin from "firebase-admin";

export const seedInitialData = async (projectId: string = "default-project") => {
  const db = admin.firestore();

  console.log(`Seeding initial data for project: ${projectId}`);

  // 1. Projects
  const projectRef = db.collection('projects').doc(projectId);
  const projectDoc = await projectRef.get();
  if (!projectDoc.exists) {
    await projectRef.set({
      name: "Proyecto Demo Praeventio",
      description: "Proyecto de prueba para gestión de seguridad industrial.",
      location: "Santiago, Chile",
      status: "active",
      members: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  // 2. Reports
  const reportsCount = await db.collection('projects').doc(projectId).collection('reports').count().get();
  if (reportsCount.data().count === 0) {
    const reportsCollection = db.collection('projects').doc(projectId).collection('reports');
    const types = ["Incidente", "Auditoría", "Observación"];
    const statuses = ["Pendiente", "Cerrado", "En Proceso"];
    
    for (let i = 0; i < 20; i++) {
      await reportsCollection.add({
        title: `Reporte de Inspección #${20 - i}`,
        date: new Date(Date.now() - i * 86400000).toISOString(),
        type: types[i % 3],
        status: statuses[i % 3],
        content: `Contenido detallado para el reporte #${20 - i}`,
        projectId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  // 3. Controls
  const controlsCount = await db.collection('projects').doc(projectId).collection('controls').count().get();
  if (controlsCount.data().count === 0) {
    const controlsCollection = db.collection('projects').doc(projectId).collection('controls');
    const controls = [
      { title: "Control de Fatiga Bio-Wearable", type: "Predictivo", status: "Operativo", efficiency: 95 },
      { title: "Sensores de Gas H2S en Perímetro", type: "Preventivo", status: "En Revisión", efficiency: 88 },
      { title: "Corte Automático por Proximidad", type: "Reactivo", status: "Operativo", efficiency: 99 },
      { title: "Monitoreo de Postura por IA", type: "Predictivo", status: "Operativo", efficiency: 92 }
    ];

    for (const control of controls) {
      await controlsCollection.add({
        ...control,
        projectId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  // 4. Materials
  const materialsCount = await db.collection('projects').doc(projectId).collection('materials').count().get();
  if (materialsCount.data().count === 0) {
    const materialsCollection = db.collection('projects').doc(projectId).collection('materials');
    const materials = [
      { name: "Arnés de Seguridad Alta Resistencia", type: "Equipo", stock: 45, minStock: 10 },
      { name: "Filtros para Máscara de Carbón", type: "Insumo", stock: 120, minStock: 50 },
      { name: "Detectores de Gas Portátiles", type: "Herramienta", stock: 12, minStock: 5 },
      { name: "Bloqueadores UV Industrial", type: "Insumo", stock: 8, minStock: 20 }
    ];

    for (const material of materials) {
      await materialsCollection.add({
        ...material,
        projectId
      });
    }
  }

  // 5. Safety Posts
  const postsCount = await db.collection('projects').doc(projectId).collection('safety_posts').count().get();
  if (postsCount.data().count === 0) {
    const postsCollection = db.collection('projects').doc(projectId).collection('safety_posts');
    const posts = [
      {
        content: "Recordatorio: La hidratación es clave trabajando bajo el sol hoy. Mantengan sus botellas llenas.",
        type: "Tip",
        userName: "Seguridad Industrial",
        userId: "system",
        likes: []
      },
      {
        content: "¡Felicitaciones al equipo de montaje por terminar la semana con 0 incidentes!",
        type: "SuccessStory",
        userName: "Gerencia Proyectos",
        userId: "system",
        likes: []
      }
    ];

    for (const post of posts) {
      await postsCollection.add({
        ...post,
        projectId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  console.log("Seeding finished.");
};
