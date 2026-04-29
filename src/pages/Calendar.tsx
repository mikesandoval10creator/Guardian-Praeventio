import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Clock, 
  MapPin, 
  Users,
  Loader2,
  X,
  LayoutGrid,
  BarChartHorizontal,
  CloudRain,
  Sun,
  Cloud,
  Wind
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, differenceInDays, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { fetchWeatherData } from '../services/orchestratorService';

import { AddEventModal } from '../components/calendar/AddEventModal';
import { EventDetailsModal } from '../components/calendar/EventDetailsModal';

interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  type: 'Capacitación' | 'Inspección' | 'Auditoría' | 'Reunión';
  projectId: string;
  endDate?: string; // Added for Gantt
  progress?: number; // Added for Gantt
}

export function Calendar() {
  const { selectedProject } = useProject();
  const { totalWorkers, plan } = useSubscription();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isAdding, setIsAdding] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [viewMode, setViewMode] = useState<'calendar' | 'gantt'>('calendar');
  const [weatherData, setWeatherData] = useState<any>(null);

  useEffect(() => {
    const loadWeather = async () => {
      try {
        const data = await fetchWeatherData();
        setWeatherData(data);
      } catch (error) {
        console.error("Failed to load weather:", error);
      }
    };
    loadWeather();
  }, []);

  // Generate forecast based on current weather
  const getForecast = () => {
    const today = new Date();
    if (!weatherData) {
      return [
        { date: today, temp: '--°C', condition: 'Cargando...', icon: Cloud, color: 'text-zinc-500', bg: 'bg-zinc-50 dark:bg-zinc-500/10' },
        { date: addDays(today, 1), temp: '--°C', condition: 'Cargando...', icon: Cloud, color: 'text-zinc-500', bg: 'bg-zinc-50 dark:bg-zinc-500/10' },
        { date: addDays(today, 2), temp: '--°C', condition: 'Cargando...', icon: Cloud, color: 'text-zinc-500', bg: 'bg-zinc-50 dark:bg-zinc-500/10' },
      ];
    }
    
    return [
      { 
        date: today, 
        temp: `${weatherData.temp}°C`, 
        condition: weatherData.condition, 
        icon: weatherData.temp < 0 ? CloudRain : (weatherData.temp > 25 ? Sun : Cloud), 
        color: weatherData.temp > 25 ? 'text-amber-500' : 'text-blue-500', 
        bg: weatherData.temp > 25 ? 'bg-amber-50 dark:bg-amber-500/10' : 'bg-blue-50 dark:bg-blue-500/10' 
      },
      { 
        date: addDays(today, 1), 
        temp: `${weatherData.temp + (Math.round(Math.random() * 4 - 2))}°C`, 
        condition: 'Pronóstico', 
        icon: Cloud, 
        color: 'text-zinc-500', 
        bg: 'bg-zinc-50 dark:bg-zinc-500/10' 
      },
      { 
        date: addDays(today, 2), 
        temp: `${weatherData.temp + (Math.round(Math.random() * 6 - 3))}°C`, 
        condition: 'Pronóstico', 
        icon: Cloud, 
        color: 'text-zinc-500', 
        bg: 'bg-zinc-50 dark:bg-zinc-500/10',
        alert: weatherData.windSpeed > 40
      },
    ];
  };

  const { data: events, loading } = useFirestoreCollection<Event>(
    selectedProject ? `projects/${selectedProject.id}/events` : null
  );

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  // Generate legal obligations based on worker count
  const legalObligations = React.useMemo(() => {
    const obligations: Event[] = [];
    if (totalWorkers >= 25) {
      // Add monthly Comité Paritario meeting
      const meetingDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 15); // 15th of the month
      obligations.push({
        id: 'legal-comite',
        title: 'Reunión Comité Paritario (DS 54)',
        date: meetingDate.toISOString(),
        time: '09:00',
        type: 'Reunión',
        description: 'Reunión mensual obligatoria del Comité Paritario de Higiene y Seguridad.',
        location: 'Sala de Reuniones',
        projectId: selectedProject?.id || '',
        endDate: new Date(meetingDate.getTime() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours
        progress: 0
      });
    }
    if (totalWorkers >= 100) {
      // Add monthly Prevencionista report
      const reportDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0); // Last day of month
      obligations.push({
        id: 'legal-depto',
        title: 'Informe Depto. Prevención (DS 40)',
        date: reportDate.toISOString(),
        time: '15:00',
        type: 'Auditoría',
        description: 'Entrega de informe mensual de accidentabilidad y gestión preventiva.',
        location: 'Gerencia',
        projectId: selectedProject?.id || '',
        endDate: new Date(reportDate.getTime() + 4 * 60 * 60 * 1000).toISOString(),
        progress: 0
      });
    }
    return obligations;
  }, [totalWorkers, currentDate, selectedProject]);

  const allEvents = [...(events || []), ...legalObligations];

  const getEventsForDay = (day: Date) => {
    return allEvents.filter(event => isSameDay(new Date(event.date), day));
  };

  // ── Round 17 (R4): honest empty duration ─────────────────────────
  // Events without an `endDate` were previously inflated to a 3-day
  // span AND given a random progress 0-99 % so the Gantt always
  // looked busy. Prevencionistas can't trust a chart that fabricates
  // work spans. We now flag those events explicitly and render them
  // as a single-day bar with a "duración no especificada" label.
  // Progress defaults to 0 instead of Math.random().
  const ganttEvents = allEvents.map(e => {
    const hasEnd = !!e.endDate;
    return {
      ...e,
      endDate: hasEnd ? e.endDate : e.date,
      durationUnspecified: !hasEnd,
      progress: typeof e.progress === 'number' ? e.progress : 0,
    };
  });

  const forecast = getForecast();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight">Planificación Estratégica</h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Calendario Operativo y Carta Gantt (Zettelkasten)
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* View Toggle */}
          <div className="flex bg-zinc-100 dark:bg-zinc-900/50 p-1 rounded-xl border border-zinc-200 dark:border-white/10">
            <button
              onClick={() => setViewMode('calendar')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                viewMode === 'calendar' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>Calendario</span>
            </button>
            <button
              onClick={() => setViewMode('gantt')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                viewMode === 'gantt' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              <BarChartHorizontal className="w-4 h-4" />
              <span>Gantt</span>
            </button>
          </div>

          <div className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-2xl p-1 w-full sm:w-auto">
            <button onClick={prevMonth} className="p-2 hover:bg-zinc-200 dark:hover:bg-white/5 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="px-2 sm:px-4 text-[10px] sm:text-xs font-black text-zinc-900 dark:text-white uppercase tracking-widest min-w-[120px] sm:min-w-[140px] text-center">
              {format(currentDate, 'MMMM yyyy', { locale: es })}
            </span>
            <button onClick={nextMonth} className="p-2 hover:bg-zinc-200 dark:hover:bg-white/5 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <button 
            onClick={() => setIsAdding(true)}
            className="bg-zinc-900 dark:bg-white text-white dark:text-black px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all shadow-xl shadow-zinc-900/5 dark:shadow-white/5 flex items-center justify-center gap-2 w-full sm:w-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Agendar</span>
          </button>
        </div>
      </div>

      {/* Weather Forecast Widget */}
      <div className="bg-white dark:bg-zinc-900/30 border border-zinc-200 dark:border-white/5 rounded-[2rem] p-4 sm:p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">Boletín Climático (Próximos 3 Días)</h2>
          <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-lg">
            Zettelkasten Activo
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {forecast.map((day, i) => {
            const Icon = day.icon;
            return (
              <div key={i} className={`p-4 rounded-2xl border ${day.alert ? 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10' : 'border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800/50'} flex items-center justify-between`}>
                <div>
                  <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">
                    {i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : format(day.date, 'EEEE', { locale: es })}
                  </div>
                  <div className="flex items-center gap-2">
                    <Icon className={`w-5 h-5 ${day.alert ? 'text-red-500' : day.color}`} />
                    <span className={`text-lg font-black ${day.alert ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-white'}`}>
                      {day.temp}
                    </span>
                  </div>
                  <div className={`text-xs font-bold mt-1 ${day.alert ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-400'}`}>
                    {day.condition}
                  </div>
                </div>
                {day.alert && (
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-red-500 justify-end mb-1">
                      <Wind className="w-3 h-3" />
                      <span className="text-[9px] font-bold uppercase tracking-wider">Alerta</span>
                    </div>
                    <p className="text-[8px] text-red-600/80 dark:text-red-400/80 max-w-[100px] leading-tight">
                      Revisar tareas críticas a la intemperie.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === 'calendar' ? (
        <div className="bg-white dark:bg-zinc-900/30 border border-zinc-200 dark:border-white/5 rounded-[2.5rem] p-6 shadow-xl">
          <div className="grid grid-cols-7 gap-4 mb-4">
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => (
              <div key={day} className="text-center text-[8px] font-black text-zinc-500 uppercase tracking-widest">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {days.map((day, i) => {
              const dayEvents = getEventsForDay(day);
              return (
                <div 
                  key={i}
                  className={`min-h-[120px] p-3 rounded-2xl border transition-all ${
                    isSameDay(day, new Date()) 
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' 
                      : 'bg-zinc-50 dark:bg-zinc-900/50 border-zinc-200 dark:border-white/5 hover:border-zinc-300 dark:hover:border-white/10'
                  }`}
                >
                  <span className={`text-xs font-black ${isSameDay(day, new Date()) ? 'text-emerald-600 dark:text-emerald-500' : 'text-zinc-500'}`}>
                    {format(day, 'd')}
                  </span>
                  <div className="mt-2 space-y-1">
                    {dayEvents.map(event => (
                      <div 
                        key={event.id}
                        onClick={() => setSelectedEvent(event)}
                        className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 text-[8px] font-bold text-zinc-900 dark:text-white uppercase tracking-wider truncate cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                      >
                        {event.title}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Gantt Chart View */
        <div className="bg-white dark:bg-zinc-900/30 border border-zinc-200 dark:border-white/5 rounded-[2.5rem] p-6 shadow-xl overflow-x-auto">
          <div className="min-w-[800px]">
            {/* Gantt Header */}
            <div className="flex border-b border-zinc-200 dark:border-white/10 pb-2 mb-4">
              <div className="w-1/4 font-black text-[10px] text-zinc-500 uppercase tracking-widest">Actividad / Hito</div>
              <div className="w-3/4 flex">
                {days.map((day, i) => (
                  <div key={i} className="flex-1 text-center text-[8px] font-bold text-zinc-400 border-l border-zinc-100 dark:border-white/5">
                    {format(day, 'd')}
                  </div>
                ))}
              </div>
            </div>

            {/* Gantt Rows */}
            <div className="space-y-3">
              {ganttEvents.map(event => {
                const startDate = new Date(event.date);
                const endDate = new Date(event.endDate!);
                
                // Calculate position and width
                const startOffset = Math.max(0, differenceInDays(startDate, monthStart));
                const duration = differenceInDays(endDate, startDate) + 1;
                const totalDays = days.length;
                
                const leftPercent = (startOffset / totalDays) * 100;
                const widthPercent = (duration / totalDays) * 100;

                return (
                  <div key={event.id} className="flex items-center group">
                    <div className="w-1/4 pr-4">
                      <div className="text-xs font-bold text-zinc-900 dark:text-white truncate">{event.title}</div>
                      <div className="text-[9px] text-zinc-500 uppercase tracking-wider">
                        {event.type}
                        {event.durationUnspecified && (
                          <span className="ml-1 text-amber-500" title="Duración no especificada — registrá una fecha de término en el evento.">
                            · duración no especificada
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="w-3/4 relative h-8 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-100 dark:border-white/5">
                      {/* Grid lines */}
                      <div className="absolute inset-0 flex">
                        {days.map((_, i) => (
                          <div key={i} className="flex-1 border-l border-zinc-100 dark:border-white/5 h-full" />
                        ))}
                      </div>

                      {/* Gantt Bar */}
                      {startOffset < totalDays && (
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(widthPercent, 100 - leftPercent)}%` }}
                          className={`absolute top-1.5 bottom-1.5 rounded-md overflow-hidden cursor-pointer transition-colors ${
                            event.durationUnspecified
                              ? 'bg-amber-500/20 border border-amber-500/50 hover:bg-amber-500/30'
                              : 'bg-emerald-500/20 border border-emerald-500/50 hover:bg-emerald-500/30'
                          }`}
                          style={{ left: `${leftPercent}%` }}
                          onClick={() => setSelectedEvent(event)}
                          title={event.durationUnspecified ? 'Duración no especificada' : undefined}
                        >
                          <div
                            className={`h-full ${event.durationUnspecified ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${event.progress}%` }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-[8px] font-black text-emerald-900 dark:text-emerald-100">
                            {event.durationUnspecified ? '—' : `${event.progress}%`}
                          </span>
                        </motion.div>
                      )}
                    </div>
                  </div>
                );
              })}
              {ganttEvents.length === 0 && (
                <div className="text-center py-8 text-zinc-500 text-sm">
                  No hay eventos en este mes para mostrar en la Carta Gantt.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upcoming Events (Only show in Calendar view) */}
      {viewMode === 'calendar' && (
        <div className="space-y-4">
          <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">Próximos Eventos</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {loading ? (
              <div className="col-span-full py-12 flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Sincronizando Agenda...</p>
              </div>
            ) : (events || []).slice(0, 3).map(event => (
              <div 
                key={event.id} 
                onClick={() => setSelectedEvent(event)}
                className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-3xl p-6 space-y-4 group hover:border-emerald-500/30 transition-all cursor-pointer shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-widest bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-200 dark:border-emerald-500/20">
                    {event.type}
                  </span>
                  <Clock className="w-4 h-4 text-zinc-500" />
                </div>
                <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight leading-tight">
                  {event.title}
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <CalendarIcon className="w-3 h-3" />
                    <span className="text-[9px] font-bold uppercase tracking-wider">
                      {format(new Date(event.date), 'dd MMMM, yyyy', { locale: es })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-500">
                    <MapPin className="w-3 h-3" />
                    <span className="text-[9px] font-bold uppercase tracking-wider">{event.location}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <AddEventModal isOpen={isAdding} onClose={() => setIsAdding(false)} />
      <EventDetailsModal 
        isOpen={!!selectedEvent} 
        onClose={() => setSelectedEvent(null)} 
        event={selectedEvent} 
      />
    </div>
  );
}
