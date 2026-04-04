import React, { useState, useRef, useEffect } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { Upload, MapPin, ZoomIn, ZoomOut, Maximize, AlertTriangle, Flame, DoorOpen, Save, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { db, storage, ref, uploadBytes, getDownloadURL, collection, addDoc, updateDoc, doc, serverTimestamp, getDocs, query, where, handleFirestoreError, OperationType } from '../../services/firebase';

interface Marker {
  id: string;
  x: number;
  y: number;
  type: 'risk' | 'extinguisher' | 'exit';
  label: string;
}

export const BlueprintViewer: React.FC = () => {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [activeMarkerType, setActiveMarkerType] = useState<Marker['type']>('risk');
  const [isAddingMarker, setIsAddingMarker] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [blueprintName, setBlueprintName] = useState('');
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null);
  const [savedBlueprints, setSavedBlueprints] = useState<any[]>([]);
  const imageRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectedProject) {
      loadBlueprints();
    }
  }, [selectedProject]);

  const loadBlueprints = async () => {
    if (!selectedProject) return;
    try {
      const q = query(collection(db, 'blueprints'), where('projectId', '==', selectedProject.id));
      const snapshot = await getDocs(q);
      const blueprintsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSavedBlueprints(blueprintsData);
    } catch (error) {
      console.error("Error loading blueprints:", error);
      handleFirestoreError(error, OperationType.LIST, 'blueprints');
    }
  };

  const handleSave = async () => {
    if (!imageSrc || !selectedProject || !user || !blueprintName) return;
    setIsSaving(true);
    try {
      let imageUrl = imageSrc;
      
      // If it's a data URL (new upload), save to storage
      if (imageSrc.startsWith('data:')) {
        const response = await fetch(imageSrc);
        const blob = await response.blob();
        const storageRef = ref(storage, `blueprints/${selectedProject.id}/${Date.now()}.png`);
        await uploadBytes(storageRef, blob);
        imageUrl = await getDownloadURL(storageRef);
      }

      const blueprintData = {
        projectId: selectedProject.id,
        name: blueprintName,
        imageUrl,
        markers,
        createdBy: user.uid,
        updatedAt: serverTimestamp()
      };

      if (selectedBlueprintId) {
        await updateDoc(doc(db, 'blueprints', selectedBlueprintId), blueprintData);
      } else {
        await addDoc(collection(db, 'blueprints'), {
          ...blueprintData,
          createdAt: serverTimestamp()
        });
      }

      alert('Plano guardado exitosamente');
      loadBlueprints();
    } catch (error) {
      console.error("Error saving blueprint:", error);
      handleFirestoreError(error, selectedBlueprintId ? OperationType.UPDATE : OperationType.CREATE, 'blueprints');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadBlueprint = (blueprint: any) => {
    setImageSrc(blueprint.imageUrl);
    setMarkers(blueprint.markers || []);
    setBlueprintName(blueprint.name);
    setSelectedBlueprintId(blueprint.id);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImageSrc(event.target?.result as string);
        setSelectedBlueprintId(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isAddingMarker || !imageRef.current) return;

    const rect = imageRef.current.getBoundingClientRect();
    
    // Calculate relative position (0 to 1)
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const newMarker: Marker = {
      id: Date.now().toString(),
      x,
      y,
      type: activeMarkerType,
      label: `Marcador ${markers.length + 1}`
    };

    setMarkers([...markers, newMarker]);
    setIsAddingMarker(false);
  };

  const getMarkerIcon = (type: Marker['type']) => {
    switch (type) {
      case 'risk': return <AlertTriangle className="w-5 h-5 text-red-500" />;
      case 'extinguisher': return <Flame className="w-5 h-5 text-orange-500" />;
      case 'exit': return <DoorOpen className="w-5 h-5 text-green-500" />;
    }
  };

  return (
    <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <MapPin className="w-6 h-6 text-blue-400" />
            Visor de Planos y Mapas
          </h3>
          <p className="text-slate-400 text-sm mt-1">
            Carga planos (exportados desde AutoCAD en formato imagen) para ubicar riesgos y recursos.
          </p>
        </div>
        
        {!imageSrc && (
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors">
            <Upload className="w-4 h-4" />
            Cargar Plano (PNG/JPG)
            <input 
              type="file" 
              accept="image/png, image/jpeg, image/svg+xml" 
              className="hidden" 
              onChange={handleImageUpload}
            />
          </label>
        )}
      </div>

      {imageSrc ? (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex items-center justify-between bg-slate-900/50 p-3 rounded-xl border border-slate-700/50">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setActiveMarkerType('risk');
                  setIsAddingMarker(true);
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${activeMarkerType === 'risk' && isAddingMarker ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                <AlertTriangle className="w-4 h-4" /> Riesgo
              </button>
              <button
                onClick={() => {
                  setActiveMarkerType('extinguisher');
                  setIsAddingMarker(true);
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${activeMarkerType === 'extinguisher' && isAddingMarker ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                <Flame className="w-4 h-4" /> Extintor
              </button>
              <button
                onClick={() => {
                  setActiveMarkerType('exit');
                  setIsAddingMarker(true);
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${activeMarkerType === 'exit' && isAddingMarker ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                <DoorOpen className="w-4 h-4" /> Salida
              </button>
              {isAddingMarker && (
                <span className="text-xs text-blue-400 ml-2 animate-pulse">
                  Haz clic en el plano para ubicar...
                </span>
              )}
            </div>
            
            <button
              onClick={() => {
                setImageSrc(null);
                setMarkers([]);
                setBlueprintName('');
              }}
              className="text-slate-400 hover:text-white text-sm"
            >
              Cambiar Plano
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mb-4">
            <input
              type="text"
              placeholder="Nombre del plano (ej. Piso 1 - Bodega)"
              value={blueprintName}
              onChange={(e) => setBlueprintName(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleSave}
              disabled={isSaving || !blueprintName || !imageSrc}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Guardar Plano
            </button>
          </div>

          {/* Viewer */}
          <div className="relative w-full h-[600px] bg-slate-900 rounded-xl overflow-hidden border border-slate-700/50">
            <TransformWrapper
              initialScale={1}
              minScale={0.5}
              maxScale={8}
              centerOnInit
              disabled={isAddingMarker} // Disable panning while adding a marker
            >
              {({ zoomIn, zoomOut, resetTransform }) => (
                <>
                  <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
                    <button onClick={() => zoomIn()} className="p-2 bg-slate-800/80 hover:bg-slate-700 text-white rounded-lg backdrop-blur-sm border border-slate-600/50">
                      <ZoomIn className="w-5 h-5" />
                    </button>
                    <button onClick={() => zoomOut()} className="p-2 bg-slate-800/80 hover:bg-slate-700 text-white rounded-lg backdrop-blur-sm border border-slate-600/50">
                      <ZoomOut className="w-5 h-5" />
                    </button>
                    <button onClick={() => resetTransform()} className="p-2 bg-slate-800/80 hover:bg-slate-700 text-white rounded-lg backdrop-blur-sm border border-slate-600/50">
                      <Maximize className="w-5 h-5" />
                    </button>
                  </div>

                  <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
                    <div className="relative inline-block">
                      <img 
                        ref={imageRef}
                        src={imageSrc} 
                        alt="Plano" 
                        className={`max-w-none ${isAddingMarker ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
                        onClick={handleImageClick}
                        draggable={false}
                      />
                      
                      {/* Markers */}
                      {markers.map((marker) => (
                        <div
                          key={marker.id}
                          className="absolute transform -translate-x-1/2 -translate-y-1/2"
                          style={{
                            left: `${marker.x * 100}%`,
                            top: `${marker.y * 100}%`,
                          }}
                        >
                          <div className="relative group">
                            <div className="p-1.5 bg-slate-900/80 rounded-full border border-slate-700 backdrop-blur-sm shadow-lg">
                              {getMarkerIcon(marker.type)}
                            </div>
                            
                            {/* Tooltip */}
                            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                              {marker.label}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </TransformComponent>
                </>
              )}
            </TransformWrapper>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="h-64 border-2 border-dashed border-slate-700 rounded-xl flex flex-col items-center justify-center text-slate-500">
            <MapPin className="w-12 h-12 mb-4 opacity-50" />
            <p>Sube un plano en formato imagen para comenzar</p>
            <p className="text-xs mt-2 opacity-70">Soporta PNG, JPG, SVG exportados desde AutoCAD o Revit</p>
          </div>
          
          {savedBlueprints.length > 0 && (
            <div className="mt-8">
              <h4 className="text-white font-medium mb-4">Planos Guardados</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {savedBlueprints.map(bp => (
                  <div 
                    key={bp.id} 
                    onClick={() => handleLoadBlueprint(bp)}
                    className="bg-slate-800 border border-slate-700 rounded-xl p-4 cursor-pointer hover:border-blue-500 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-500/20 rounded-lg">
                        <MapPin className="w-5 h-5 text-blue-400" />
                      </div>
                      <div>
                        <h5 className="text-white font-medium">{bp.name}</h5>
                        <p className="text-xs text-slate-400">{bp.markers?.length || 0} marcadores</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
