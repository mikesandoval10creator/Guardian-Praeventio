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
import { humanErrorMessage } from '../../lib/humanError';


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
    // [Hy3-audit 3c4aa66d-73fe-810c-969d-fcdf253472d1 2026-08-25]:
    // tracks whether the XR session ever reached setActive(true).
    // When the start path fails before that point (e.g. webgl2
    // unavailable, requestReferenceSpace rejected, user cancelled
    // mid-init), the cleanup runs session.end() but onEnd never
    // fires — so the consumer's onSessionEnd callback isn't called.
    // Without this flag, the consumer's UI state desyncs and may
    // attempt to mount a duplicate XR session. We mirror onSessionEnd
    // from the cleanup when everActive is still false.
    let everActive = false;
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
        // strictFunctionTypes: el `xr.requestSession()` (DOM WebXR types)
        // devuelve un `XRSession` nativo más ancho que nuestro
        // `XRSessionInstance` local. Cast explícito en el boundary
        // porque solo usamos las propiedades intersectadas.
        session = (await xr.requestSession('immersive-ar', {
          requiredFeatures: ['hit-test'],
          optionalFeatures: ['anchors', 'dom-overlay', 'light-estimation'],
          domOverlay: { root: overlayRef.current },
        })) as unknown as XRSessionInstance;
      } catch (err) {
        setError(humanErrorMessage(`No se pudo iniciar AR: ${(err as Error).message}`));
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
        // [Hy3-audit 3c4aa66d-73fe-8121-bef5-cb5e1618dfd0 2026-08-25]:
        // the consumer's previewMesh carries its own geometry/materials.
        // When the AR session ends and the reticle is disposed, the
        // ring's geometry/material are released (L159-162), but the
        // previewMesh's GPU resources stay resident across repeated
        // sessions — leaks on every mount in long-running faena use.
        // Traverse and dispose every Mesh/Line/Sprite material and
        // geometry on unmount. Guard against missing/typed-as-undefined
        // .geometry and .material on Object3D-derived types.
        disposables.push(() => {
          previewMesh.traverse((child) => {
            const node = child as THREE.Mesh;
            if (node.geometry?.dispose) node.geometry.dispose();
            const mat = node.material as
              | THREE.Material
              | THREE.Material[]
              | undefined;
            if (Array.isArray(mat)) {
              mat.forEach((m) => m?.dispose?.());
            } else if (mat?.dispose) {
              mat.dispose();
            }
          });
        });
      }

      // Hit-test source
      // [Hy3-audit 3c4aa66d-73fe-81fd-bc24-f4e896f8855a 2026-08-25]:
      // requestReferenceSpace() can reject (not all XR runtimes support
      // 'local' or 'viewer', permissions, frame-rate mismatch). An
      // unhandled rejection here aborts start() mid-flight: no
      // setError, no session.end(), component stays mounted showing a
      // black reticle. Wrap both acquisitions in try; on failure,
      // surface a human message and end the session cleanly so the
      // caller can recover.
      let viewerSpace: XRReferenceSpace | null = null;
      let localSpace: XRReferenceSpace | null = null;
      try {
        // The XRSessionInstance type we use locally is wider than what
        // requestReferenceSpace returns in DOM lib types; cast at the
        // boundary because we only ever read pose/timestamp.
        viewerSpace = (await session.requestReferenceSpace(
          'viewer',
        )) as XRReferenceSpace;
        localSpace = (await session.requestReferenceSpace(
          'local',
        )) as XRReferenceSpace;
      } catch (err) {
        setError(
          humanErrorMessage(
            `No se pudo inicializar el espacio de referencia AR: ${(err as Error).message}`,
          ),
        );
        await session.end().catch(() => {});
        return;
      }
      if (cancelled || !session || !viewerSpace || !localSpace) return;
      if (typeof session.requestHitTestSource === 'function') {
        try {
          hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
        } catch {
          // Fallback (see render loop): pin the reticle to a fixed
          // distance in front of the viewer pose so the worker can
          // still anchor by tapping. Lives at L266+ in the
          // setAnimationLoop callback.
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
      everActive = true;

      // Render loop
      renderer.setAnimationLoop((_t: number, frame?: XRFrame) => {
        if (!frame || !renderer) return;
        if (hitTestSource) {
          const results = frame.getHitTestResults(hitTestSource);
          if (results.length > 0) {
            const pose = results[0].getPose(localSpace!);
            if (pose) {
              reticle.visible = true;
              reticle.matrix.fromArray(pose.transform.matrix);
            }
          } else {
            reticle.visible = false;
          }
        } else {
          // [Hy3-audit 3c4aa66d-73fe-813f-97ac-d8e6ca4fb05a 2026-08-25]:
          // fallback when the runtime refused requestHitTestSource.
          // Earlier the comment promised a user-driven "Ancla aquí"
          // button that didn't exist in the repo — workers on
          // hit-test-less hardware couldn't place the AR anchor at all.
          // Pin the reticle to a fixed distance in front of the
          // viewer pose, always visible. onSelect below then emits
          // the reticle.matrix as the anchor pose. Camera-pose
          // anchoring is worse than a real hit-test but at least the
          // user can complete the placement workflow. The consumer
          // can still pass onSelectAnchor to capture this pose.
          const viewerPose = frame.getViewerPose(localSpace!);
          if (viewerPose) {
            const m = new THREE.Matrix4().fromArray(
              viewerPose.transform.matrix,
            );
            const offset = new THREE.Vector3(0, 0, -1.5).applyMatrix4(m);
            reticle.position.copy(offset);
            reticle.quaternion.setFromRotationMatrix(m);
            reticle.visible = true;
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
      // [Hy3-audit 3c4aa66d-73fe-810c-969d-fcdf253472d1 2026-08-25]:
      // if start() never reached setActive(true) (failure path or
      // early unmount), the 'end' event above won't fire on the
      // session and onSessionEnd?.() inside onEnd never runs. Mirror
      // the callback here so the consumer's UI state stays in sync.
      if (!everActive) {
        setActive(false);
        onSessionEnd?.();
      }
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
          {humanErrorMessage(error)}
        </div>
      )}
      {/* Children render OVER the camera feed. pointer-events-auto re-enabled
          on actionable subtrees inside domOverlayContent. */}
      <div className="pointer-events-none absolute inset-0">{domOverlayContent}</div>
    </div>
  );
}
