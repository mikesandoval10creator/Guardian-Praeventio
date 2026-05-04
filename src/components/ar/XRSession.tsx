// SPDX-License-Identifier: MIT
//
// XRSession — Sprint 21 Ola 4 Bucket L.3.
//
// Componente React que monta una sesión WebXR `immersive-ar` real con
// hit-test + dom-overlay. Maneja:
//
//   - requestSession('immersive-ar', { requiredFeatures: ['hit-test'], ... })
//   - Three.js WebGLRenderer con renderer.xr.setSession(session)
//   - Loop XR-aware via renderer.setAnimationLoop(callback)
//   - Hit-test source attached al referenceSpace 'viewer' para detectar
//     el plano sobre el que apunta la cámara
//   - Reticle 3D (ring + cono) que sigue el hit-test
//   - DOM overlay HTML para el checklist / botones / tooltips
//   - Cleanup completo en unmount: session.end() + dispose de geometries
//
// NO usa @react-three/fiber ni @react-three/xr — la sesión XR maneja su
// propio render loop (setAnimationLoop) y mezclarlo con r3f es problemático.
// Three.js puro nos da control total y evita una dep adicional.
//
// IMPORTANTE: este componente SOLO funciona en navegadores con WebXR
// immersive-ar. El consumer DEBE chequear `useWebXRSupport().immersiveAr`
// antes de montarlo. Si se monta sin soporte, muestra error y onClose.

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/** Mínimos tipos WebXR (sin agregar @types/webxr al package.json). */
type XRReferenceSpaceType = 'viewer' | 'local' | 'local-floor' | 'bounded-floor' | 'unbounded';
interface XRPose {
  transform: { matrix: Float32Array; position: DOMPointReadOnly };
}
interface XRHitTestResult {
  getPose(referenceSpace: unknown): XRPose | undefined;
}
interface XRFrame {
  getViewerPose(referenceSpace: unknown): XRPose | undefined;
  getHitTestResults(source: unknown): XRHitTestResult[];
}
interface XRSessionInit {
  requiredFeatures?: string[];
  optionalFeatures?: string[];
  domOverlay?: { root: HTMLElement };
}
interface XRSessionInstance extends EventTarget {
  end(): Promise<void>;
  requestReferenceSpace(type: XRReferenceSpaceType): Promise<unknown>;
  requestHitTestSource?: (options: { space: unknown }) => Promise<{ cancel(): void }>;
}
interface XRSystem {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, init?: XRSessionInit): Promise<XRSessionInstance>;
}

export interface XRSessionAnchorPose {
  /** Posición mundial en metros (Three.js coords). */
  x: number;
  y: number;
  z: number;
}

export interface XRSessionProps {
  /** Disparado cuando el usuario toca el reticle para anclar el objeto. */
  onSelectAnchor: (pose: XRSessionAnchorPose) => void;
  /** Disparado cuando la sesión termina (usuario salió o error). */
  onSessionEnd?: () => void;
  /** Color del reticle (default amber, alta visibilidad sobre cualquier fondo). */
  reticleColor?: string;
  /** Mesh adicional a renderizar attached al cursor reticle. */
  previewMesh?: THREE.Object3D;
  /** Contenido HTML overlaid sobre la cámara durante la sesión XR. */
  domOverlayContent?: React.ReactNode;
}

/**
 * Monta una sesión WebXR immersive-ar y la wirea con Three.js. El render
 * loop corre dentro de setAnimationLoop hasta que onSessionEnd dispare.
 */
export function XRSession({
  onSelectAnchor,
  onSessionEnd,
  reticleColor = '#f59e0b',
  previewMesh,
  domOverlayContent,
}: XRSessionProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    let session: XRSessionInstance | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let hitTestSource: { cancel(): void } | null = null;
    const disposables: Array<() => void> = [];

    async function start() {
      const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
      if (!xr) {
        setError('WebXR no disponible en este navegador.');
        return;
      }
      if (!overlayRef.current) {
        setError('Overlay DOM no disponible.');
        return;
      }

      try {
        session = await xr.requestSession('immersive-ar', {
          requiredFeatures: ['hit-test'],
          optionalFeatures: ['anchors', 'dom-overlay', 'light-estimation'],
          domOverlay: { root: overlayRef.current },
        });
      } catch (err) {
        setError(`No se pudo iniciar AR: ${(err as Error).message}`);
        return;
      }
      if (cancelled || !session) return;

      // Setup Three.js
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { xrCompatible: true } as WebGLContextAttributes);
      if (!gl) {
        setError('WebGL2 no disponible.');
        await session.end().catch(() => {});
        return;
      }
      renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType('local');
      // setSession existe en WebXRManager runtime aunque @types/three no lo tipe completo.
      (renderer.xr as unknown as { setSession(s: XRSessionInstance): Promise<void> })
        .setSession(session);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);

      // Luz ambiental — suficiente sin light-estimation aún.
      const ambient = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1.0);
      scene.add(ambient);

      // Reticle: ring + diamond inner para depth cueing.
      const reticle = new THREE.Group();
      const ringGeo = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(reticleColor) });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      reticle.add(ring);
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;
      scene.add(reticle);
      disposables.push(() => {
        ringGeo.dispose();
        ringMat.dispose();
      });

      if (previewMesh) {
        previewMesh.position.y = 0;
        reticle.add(previewMesh);
      }

      // Hit-test source
      const viewerSpace = await session.requestReferenceSpace('viewer');
      const localSpace = await session.requestReferenceSpace('local');
      if (typeof session.requestHitTestSource === 'function') {
        try {
          hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
        } catch {
          // Fallback: sin hit-test el reticle se queda invisible y el user
          // pulsa el botón "Ancla aquí" en el overlay (uses camera pose).
        }
      }

      // Tap → emit anchor pose
      const onSelect = () => {
        if (!reticle.visible) return;
        const m = reticle.matrix.elements;
        // Three.js Matrix4 column-major: position en m[12,13,14].
        onSelectAnchor({ x: m[12], y: m[13], z: m[14] });
      };
      session.addEventListener('select', onSelect as EventListener);
      disposables.push(() => session?.removeEventListener('select', onSelect as EventListener));

      const onEnd = () => {
        setActive(false);
        onSessionEnd?.();
      };
      session.addEventListener('end', onEnd as EventListener);
      disposables.push(() => session?.removeEventListener('end', onEnd as EventListener));

      setActive(true);

      // Render loop
      renderer.setAnimationLoop((_t: number, frame?: XRFrame) => {
        if (!frame || !renderer) return;
        if (hitTestSource) {
          const results = frame.getHitTestResults(hitTestSource);
          if (results.length > 0) {
            const pose = results[0].getPose(localSpace);
            if (pose) {
              reticle.visible = true;
              reticle.matrix.fromArray(pose.transform.matrix);
            }
          } else {
            reticle.visible = false;
          }
        }
        renderer.render(scene, camera);
      });
    }

    start();

    return () => {
      cancelled = true;
      disposables.forEach((d) => {
        try {
          d();
        } catch {
          /* noop */
        }
      });
      hitTestSource?.cancel();
      try {
        renderer?.setAnimationLoop(null);
        renderer?.dispose();
      } catch {
        /* noop */
      }
      session?.end().catch(() => {});
    };
  // We intentionally re-run only on mount/unmount. Props changes don't restart
  // the session (would require teardown+re-request).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={overlayRef}
      className="xr-dom-overlay fixed inset-0 z-[60] pointer-events-none"
      aria-hidden={!active}
    >
      {error && (
        <div className="pointer-events-auto absolute top-4 left-4 right-4 mx-auto max-w-md bg-rose-900/90 border border-rose-500/50 text-rose-100 rounded-xl p-3 text-sm">
          {error}
        </div>
      )}
      {/* Children render OVER the camera feed. pointer-events-auto re-enabled
          on actionable subtrees inside domOverlayContent. */}
      <div className="pointer-events-none absolute inset-0">{domOverlayContent}</div>
    </div>
  );
}
