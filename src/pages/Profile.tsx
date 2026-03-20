import { User as UserIcon, Shield, Award, Settings, LogOut, Bell, Lock, HelpCircle, ChevronRight, Activity, MapPin } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { useFirebase } from '../contexts/FirebaseContext';
import { logOut } from '../services/firebase';
import { useNavigate } from 'react-router-dom';

export function Profile() {
  const { user, isAdmin } = useFirebase();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logOut();
    navigate('/login');
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center text-center mb-8">
        <div className="relative mb-6">
          <div className="w-32 h-32 bg-zinc-100 dark:bg-zinc-800 rounded-full border-4 border-emerald-500/20 flex items-center justify-center overflow-hidden shadow-xl">
            {user?.photoURL ? (
              <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <UserIcon className="w-16 h-16 text-zinc-400" />
            )}
          </div>
          <div className="absolute bottom-0 right-0 bg-emerald-500 p-2 rounded-full border-4 border-white dark:border-zinc-950 shadow-lg">
            <Shield className="w-4 h-4 text-white" />
          </div>
        </div>
        <h2 className="text-2xl font-black uppercase tracking-tighter">{user?.displayName || 'Usuario'}</h2>
        <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
          {isAdmin ? 'Administrador del Sistema' : 'Supervisor de Seguridad'}
        </p>
        <p className="text-[10px] text-zinc-400 mt-1 font-mono">{user?.email}</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4 flex flex-col items-center gap-1 bg-zinc-900 text-white border-none">
          <span className="text-lg font-black">12</span>
          <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Cursos</span>
        </Card>
        <Card className="p-4 flex flex-col items-center gap-1 bg-zinc-900 text-white border-none">
          <span className="text-lg font-black">450</span>
          <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Puntos</span>
        </Card>
        <Card className="p-4 flex flex-col items-center gap-1 bg-zinc-900 text-white border-none">
          <span className="text-lg font-black">03</span>
          <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Logros</span>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-500 px-2">Información Profesional</h2>
        <Card className="divide-y divide-zinc-100 dark:divide-zinc-800">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded-xl">
                <Activity className="w-4 h-4 text-zinc-500" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Empresa</span>
                <span className="text-xs font-black uppercase tracking-tight">Praeventio Corp</span>
              </div>
            </div>
          </div>
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded-xl">
                <MapPin className="w-4 h-4 text-zinc-500" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Ubicación</span>
                <span className="text-xs font-black uppercase tracking-tight">Santiago, Chile</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-500 px-2">Ajustes</h2>
        <Card className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {[
            { icon: Bell, label: 'Notificaciones' },
            { icon: Lock, label: 'Seguridad y Privacidad' },
            { icon: Settings, label: 'Preferencias' },
            { icon: HelpCircle, label: 'Ayuda y Soporte' },
          ].map((item) => (
            <div key={item.label} className="p-4 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors cursor-pointer">
              <div className="flex items-center gap-4">
                <div className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded-xl">
                  <item.icon className="w-4 h-4 text-zinc-500" />
                </div>
                <span className="text-xs font-bold uppercase tracking-tight">{item.label}</span>
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-300" />
            </div>
          ))}
        </Card>
      </div>

      <Button variant="danger" onClick={handleLogout} className="w-full py-4 rounded-2xl text-xs font-black uppercase tracking-widest">
        <LogOut className="w-4 h-4 mr-2" />
        Cerrar Sesión
      </Button>
    </div>
  );
}
