import { Sun, Wind, CloudRain, Thermometer, MapPin, Navigation } from 'lucide-react';
import { Card } from '../shared/Card';

interface WeatherWidgetProps {
  weather: {
    temp: number;
    condition: string;
    humidity: number;
    uv: number;
    airQuality: string;
    altitude: number;
    location: string;
  };
}

export function WeatherWidget({ weather }: WeatherWidgetProps) {
  return (
    <Card className="p-6 bg-gradient-to-br from-emerald-600 to-emerald-800 text-white border-none">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-emerald-200" />
          <span className="text-sm font-medium tracking-wide uppercase">{weather.location}</span>
        </div>
        <div className="flex items-center gap-1 bg-white/20 px-3 py-1 rounded-full backdrop-blur-md">
          <Navigation className="w-3 h-3" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Simulado</span>
        </div>
      </div>

      <div className="flex items-end justify-between mb-8">
        <div className="flex items-center gap-4">
          <span className="text-7xl font-light tracking-tighter">{weather.temp}°</span>
          <div className="flex flex-col">
            <span className="text-lg font-medium leading-none mb-1">{weather.condition}</span>
            <span className="text-xs text-emerald-100 uppercase tracking-widest">Boletín Climático</span>
          </div>
        </div>
        <Sun className="w-16 h-16 text-yellow-300 drop-shadow-lg" />
      </div>

      <div className="grid grid-cols-4 gap-4 pt-6 border-t border-white/20">
        <div className="flex flex-col items-center gap-1">
          <Wind className="w-4 h-4 text-emerald-200" />
          <span className="text-xs font-bold">{weather.airQuality}</span>
          <span className="text-[10px] text-emerald-200 uppercase tracking-wider">Aire</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Sun className="w-4 h-4 text-emerald-200" />
          <span className="text-xs font-bold">{weather.uv}</span>
          <span className="text-[10px] text-emerald-200 uppercase tracking-wider">UV</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <CloudRain className="w-4 h-4 text-emerald-200" />
          <span className="text-xs font-bold">{weather.humidity}%</span>
          <span className="text-[10px] text-emerald-200 uppercase tracking-wider">Hum</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Thermometer className="w-4 h-4 text-emerald-200" />
          <span className="text-xs font-bold">{weather.altitude}m</span>
          <span className="text-[10px] text-emerald-200 uppercase tracking-wider">Alt</span>
        </div>
      </div>
    </Card>
  );
}
