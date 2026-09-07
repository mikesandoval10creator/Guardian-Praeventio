import { useState, useEffect } from 'react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

const MAX_CAPSULES = 100;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 10_000;
const MAX_RADIUS_METERS = 10_000;
const MAX_MEDIA_URL_LENGTH = 2_048;

export interface WisdomCapsuleData {
  id: string;
  title: string;
  content: string;
  lat: number;
  lng: number;
  radius: number; // meters, default 50
  machineId?: string;
  nodeId?: string;
  mediaUrl?: string;
  tenantId: string;
  projectId: string;
}

export interface WisdomCapsuleScope {
  projectId: string | null;
  tenantId: string | null;
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isOptionalString(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

function parseCapsule(
  id: string,
  raw: unknown,
  scope: WisdomCapsuleScope,
): WisdomCapsuleData | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const { projectId, tenantId } = scope;
  const radius = data.radius === undefined ? 50 : data.radius;

  if (
    typeof projectId !== 'string' || projectId.length === 0 ||
    typeof tenantId !== 'string' || tenantId.length === 0 ||
    data.projectId !== projectId || data.tenantId !== tenantId ||
    typeof data.title !== 'string' || data.title.length === 0 || data.title.length > MAX_TITLE_LENGTH ||
    typeof data.content !== 'string' || data.content.length > MAX_CONTENT_LENGTH ||
    typeof data.lat !== 'number' || !Number.isFinite(data.lat) || data.lat < -90 || data.lat > 90 ||
    typeof data.lng !== 'number' || !Number.isFinite(data.lng) || data.lng < -180 || data.lng > 180 ||
    typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0 || radius > MAX_RADIUS_METERS ||
    !isOptionalString(data.machineId, 256) ||
    !isOptionalString(data.nodeId, 256) ||
    !isOptionalString(data.mediaUrl, MAX_MEDIA_URL_LENGTH)
  ) {
    return null;
  }

  return {
    id,
    title: data.title,
    content: data.content,
    lat: data.lat,
    lng: data.lng,
    radius,
    ...(data.machineId === undefined ? {} : { machineId: data.machineId }),
    ...(data.nodeId === undefined ? {} : { nodeId: data.nodeId }),
    ...(data.mediaUrl === undefined ? {} : { mediaUrl: data.mediaUrl }),
    tenantId,
    projectId,
  };
}

export function useWisdomCapsules(scope?: WisdomCapsuleScope) {
  const projectId = scope?.projectId ?? null;
  const tenantId = scope?.tenantId ?? null;
  const [capsules, setCapsules] = useState<WisdomCapsuleData[]>([]);
  const [nearbyCapsule, setNearbyCapsule] = useState<WisdomCapsuleData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCapsules([]);
    setNearbyCapsule(null);

    if (!projectId || !tenantId) return () => { cancelled = true; };

    const currentScope = { projectId, tenantId };
    const scopedQuery = query(
      collection(db, 'wisdomCapsules'),
      where('tenantId', '==', tenantId),
      where('projectId', '==', projectId),
      limit(MAX_CAPSULES),
    );

    getDocs(scopedQuery)
      .then((snap) => {
        if (cancelled) return;
        const valid = snap.docs
          .map((d) => parseCapsule(d.id, d.data(), currentScope))
          .filter((capsule): capsule is WisdomCapsuleData => capsule !== null);
        setCapsules(valid);
      })
      .catch(() => {
        if (cancelled) return;
        setCapsules([]);
        setNearbyCapsule(null);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, tenantId]);

  // Watch GPS and compute proximity only for the currently scoped capsules.
  useEffect(() => {
    if (!('geolocation' in navigator) || capsules.length === 0) return undefined;

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const { latitude, longitude } = coords;
        const nearby = capsules.find(c =>
          haversineDistance(latitude, longitude, c.lat, c.lng) <= c.radius
        ) ?? null;
        setNearbyCapsule(prev => {
          // Only update if capsule id changed to avoid re-renders
          if (prev?.id === nearby?.id) return prev;
          if (nearby) navigator.vibrate?.([80, 40, 80]);
          return nearby;
        });
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [capsules]);

  return { nearbyCapsule, capsules };
}
