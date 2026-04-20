export interface CompressionOptions {
  maxSizeMB?: number;
  maxWidthOrHeight?: number;
  useWebP?: boolean;
}

/**
 * Comprime una imagen en el lado del cliente (Navegador) usando Canvas API.
 * Indispensable para zonas de baja conectividad y reducción de costos de Storage.
 */
export const compressImage = async (
  file: File,
  options: CompressionOptions = {}
): Promise<File> => {
  const {
    maxSizeMB = 0.5, // 500KB default target for field operations
    maxWidthOrHeight = 1280, // Resolucion suficiente para auditorias
    useWebP = true,
  } = options;

  return new Promise((resolve, reject) => {
    // Si no es una imagen o es un SVG, devolver original
    if (!file.type.startsWith('image/') || file.type.includes('svg')) {
      return resolve(file);
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        // Calcular nuevas dimensiones
        let width = img.width;
        let height = img.height;

        if (width > maxWidthOrHeight || height > maxWidthOrHeight) {
          if (width > height) {
            height = Math.round((height * maxWidthOrHeight) / width);
            width = maxWidthOrHeight;
          } else {
            width = Math.round((width * maxWidthOrHeight) / height);
            height = maxWidthOrHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return resolve(file); // Failsafe
        }

        ctx.drawImage(img, 0, 0, width, height);

        const targetMimeType = useWebP ? 'image/webp' : 'image/jpeg';
        let quality = 0.9;
        
        // Función para ajustar calidad iterativamente según maxSizeMB
        const targetBytes = maxSizeMB * 1024 * 1024;
        
        const compressToSize = () => {
          canvas.toBlob(
            (blob) => {
              if (!blob) return resolve(file);

              if (blob.size > targetBytes && quality > 0.1) {
                quality -= 0.15; // Bajar de forma agresiva para no bloquear el Hilo Principal
                compressToSize();
              } else {
                const extension = useWebP ? 'webp' : 'jpg';
                const originalName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                const newFilename = `${originalName}_optimizado.${extension}`;
                
                const compressedFile = new File([blob], newFilename, {
                  type: targetMimeType,
                  lastModified: Date.now(),
                });
                
                // Si la compresión resultó peor (ej. PNG pequeño), devolvemos el original
                if (compressedFile.size > file.size) {
                  resolve(file);
                } else {
                  resolve(compressedFile);
                }
              }
            },
            targetMimeType,
            quality
          );
        };

        compressToSize();
      };
      
      img.onerror = () => resolve(file); // Si hay falla en cargar, devolvemos el original para no interrumpir
    };
    reader.onerror = () => resolve(file);
  });
};
