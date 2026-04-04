import { useEffect, useRef } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { useNotifications } from '../contexts/NotificationContext';
import { NodeType } from '../types';

export function useAutonomousAlerts() {
  const { selectedProject } = useProject();
  const { nodes, environment } = useUniversalKnowledge();
  const { addNotification } = useNotifications();
  const triggeredAlerts = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedProject || !environment?.weather) return;

    const checkConditions = () => {
      try {
        const weather = environment.weather;
        const temp = weather.temp;
        const wind = weather.windSpeed;
        
        const today = new Date().toDateString();

        // Rule 1: High Wind + Work at Heights
        // Threshold: 30 km/h
        if (wind > 30) {
          const heightTasks = nodes.filter(n => 
            (n.type === NodeType.TASK || n.type === NodeType.RISK) &&
            (n.title.toLowerCase().includes('altura') || (n.description || '').toLowerCase().includes('altura') || n.tags.includes('altura')) &&
            n.projectId === selectedProject.id
          );

          if (heightTasks.length > 0) {
            const alertId = `wind-height-${selectedProject.id}-${today}`;
            if (!triggeredAlerts.current.has(alertId)) {
              addNotification({
                title: 'Alerta Autónoma: Viento Peligroso',
                message: `Vientos de ${wind} km/h detectados. Hay ${heightTasks.length} tareas en altura registradas. Considere suspender maniobras de izaje o trabajos en techo.`,
                type: 'warning'
              });
              triggeredAlerts.current.add(alertId);
            }
          }
        }

        // Rule 2: Extreme Heat
        // Threshold: 32°C
        if (temp > 32) {
           const alertId = `heat-${selectedProject.id}-${today}`;
           if (!triggeredAlerts.current.has(alertId)) {
              addNotification({
                title: 'Alerta Autónoma: Estrés Térmico',
                message: `Temperatura crítica de ${temp}°C. Active protocolo de hidratación (DS 594) y pausas activas para el personal en terreno.`,
                type: 'warning'
              });
              triggeredAlerts.current.add(alertId);
           }
        }

        // Rule 3: Hot Work + High Wind / Low Humidity (Fire Risk)
        // Threshold: Temp > 28, Wind > 20
        if (temp > 28 && wind > 20) {
            const hotWorks = nodes.filter(n => 
                (n.type === NodeType.TASK || n.type === NodeType.RISK) &&
                (n.title.toLowerCase().includes('soldadura') || n.title.toLowerCase().includes('corte') || n.tags.includes('caliente')) &&
                n.projectId === selectedProject.id
            );

            if (hotWorks.length > 0) {
                const alertId = `fire-risk-${selectedProject.id}-${today}`;
                if (!triggeredAlerts.current.has(alertId)) {
                    addNotification({
                        title: 'Alerta Autónoma: Riesgo de Incendio',
                        message: `Condiciones propicias para incendio (Temp: ${temp}°C, Viento: ${wind} km/h). Extreme precauciones en los ${hotWorks.length} trabajos en caliente programados.`,
                        type: 'error'
                    });
                    triggeredAlerts.current.add(alertId);
                }
            }
        }

      } catch (error) {
        console.error("Error in autonomous alerts:", error);
      }
    };

    // Initial check
    checkConditions();
  }, [selectedProject, nodes, environment?.weather, addNotification]);
}
