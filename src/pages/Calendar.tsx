import React, { useState } from 'react';
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
  X
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';

import { AddEventModal } from '../components/calendar/AddEventModal';

interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  type: 'Capacitación' | 'Inspección' | 'Auditoría' | 'Reunión';
  projectId: string;
}

export function Calendar() {
  const { selectedProject } = useProject();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isAdding, setIsAdding] = useState(false);

  const { data: events, loading } = useFirestoreCollection<Event>(
    selectedProject ? `projects/${selectedProject.id}/events` : null
  );

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  const getEventsForDay = (day: Date) => {
    return (events || []).filter(event => isSameDay(new Date(event.date), day));
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight">Calendario Operativo</h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Planificación Táctica y Control de Hitos
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex items-center justify-between bg-zinc-900/50 border border-white/10 rounded-2xl p-1 w-full sm:w-auto">
            <button onClick={prevMonth} className="p-2 hover:bg-white/5 rounded-xl text-zinc-400 hover:text-white transition-all">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="px-2 sm:px-4 text-[10px] sm:text-xs font-black text-white uppercase tracking-widest min-w-[120px] sm:min-w-[140px] text-center">
              {format(currentDate, 'MMMM yyyy', { locale: es })}
            </span>
            <button onClick={nextMonth} className="p-2 hover:bg-white/5 rounded-xl text-zinc-400 hover:text-white transition-all">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <button 
            onClick={() => setIsAdding(true)}
            className="bg-white text-black px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 transition-all shadow-xl shadow-white/5 flex items-center justify-center gap-2 w-full sm:w-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Agendar Evento</span>
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="bg-zinc-900/30 border border-white/5 rounded-[2.5rem] p-6">
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
                    ? 'bg-emerald-500/10 border-emerald-500/30' 
                    : 'bg-zinc-900/50 border-white/5 hover:border-white/10'
                }`}
              >
                <span className={`text-xs font-black ${isSameDay(day, new Date()) ? 'text-emerald-500' : 'text-zinc-500'}`}>
                  {format(day, 'd')}
                </span>
                <div className="mt-2 space-y-1">
                  {dayEvents.map(event => (
                    <div 
                      key={event.id}
                      className="p-1.5 rounded-lg bg-zinc-800 border border-white/5 text-[8px] font-bold text-white uppercase tracking-wider truncate"
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

      {/* Upcoming Events */}
      <div className="space-y-4">
        <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">Próximos Eventos</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? (
            <div className="col-span-full py-12 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
              <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Sincronizando Agenda...</p>
            </div>
          ) : (events || []).slice(0, 3).map(event => (
            <div key={event.id} className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 space-y-4 group hover:border-emerald-500/30 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">
                  {event.type}
                </span>
                <Clock className="w-4 h-4 text-zinc-500" />
              </div>
              <h3 className="text-sm font-black text-white uppercase tracking-tight leading-tight">
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
      <AddEventModal isOpen={isAdding} onClose={() => setIsAdding(false)} />
    </div>
  );
}
