import { useState, useEffect, useCallback } from 'react';

interface BluetoothDevice {
  id: string;
  name?: string;
  lastSeen: number;
}

export function useBluetoothMesh() {
  const [isSupported, setIsSupported] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [nearbyDevices, setNearbyDevices] = useState<BluetoothDevice[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if ('bluetooth' in navigator) {
      setIsSupported(true);
    }
  }, []);

  const startScanning = useCallback(async () => {
    if (!isSupported) {
      setError('Web Bluetooth API no soportada en este navegador.');
      return;
    }

    try {
      setIsScanning(true);
      setError(null);

      // Note: Web Bluetooth API currently requires user gesture to request device.
      // It doesn't support background scanning for arbitrary devices easily without specific service UUIDs.
      // This is a simulated mesh for proximity beacons as a proof of concept.
      
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['battery_service'] // Example service
      });

      if (device) {
        setNearbyDevices(prev => {
          const existing = prev.find(d => d.id === device.id);
          if (existing) {
            return prev.map(d => d.id === device.id ? { ...d, lastSeen: Date.now() } : d);
          }
          return [...prev, { id: device.id, name: device.name || 'Dispositivo Desconocido', lastSeen: Date.now() }];
        });
      }

    } catch (err: any) {
      if (err.name === 'NotFoundError') {
        // User cancelled or no devices found
      } else {
        setError(err.message || 'Error al escanear dispositivos Bluetooth.');
      }
    } finally {
      setIsScanning(false);
    }
  }, [isSupported]);

  return {
    isSupported,
    isScanning,
    nearbyDevices,
    error,
    startScanning
  };
}
