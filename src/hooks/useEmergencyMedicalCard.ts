// Praeventio Guard — emergency medical card (#2 TriageBeacon, step 1: data).
//
// Founder vision: in a serious emergency, a responder / the health service can
// be PRE-WARNED with the worker's blood type + allergies to act faster. This is
// privacy-respecting and OPT-IN: the worker explicitly authorizes sharing the
// card (`shareConsent`) so it may be shown on the TriageBeacon and broadcast
// over the Bluetooth mesh during an emergency. Off by default.
//
// Stored ON-DEVICE only (idb-keyval), never in Firestore — the whole point is
// that it is readable OFFLINE, when an emergency happens with no signal and the
// mesh is the only channel. Same offline-first pattern as
// `useFallDetectionPreference`. The card is the worker's own data on the
// worker's own device; it leaves the device only when they consent AND an
// emergency is active (step 2/3 wire the beacon + mesh).

import { useState, useEffect, useCallback } from 'react';
import { get, set } from 'idb-keyval';
import { logger } from '../utils/logger';

const STORAGE_KEY = 'praeventio:emergency-medical-card';

export type BloodType = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';

export const BLOOD_TYPES: readonly BloodType[] = [
  'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-',
] as const;

export interface EmergencyMedicalCard {
  bloodType?: BloodType;
  /** Free-text allergies the worker chooses to record (e.g. "Penicilina, látex"). */
  allergies?: string;
  /**
   * The worker EXPLICITLY authorizes sharing this card during an emergency
   * (shown on the TriageBeacon + broadcast over the mesh) to speed up care.
   * `false` by default — nothing is shared without an affirmative opt-in.
   */
  shareConsent: boolean;
  /** ISO timestamp of the last edit. */
  updatedAt?: string;
}

const EMPTY: EmergencyMedicalCard = { shareConsent: false };

export interface UseEmergencyMedicalCard {
  card: EmergencyMedicalCard;
  loading: boolean;
  saveCard: (patch: Partial<EmergencyMedicalCard>) => Promise<EmergencyMedicalCard>;
  /** True only when the worker has consented AND there is something to share. */
  hasShareableCard: boolean;
}

/** Returns the card to broadcast during an emergency, or `null` when the worker
 *  has not consented (or the card is empty). Pure helper — used by the
 *  TriageBeacon / mesh so the consent gate lives in one place. */
export function shareableCard(
  card: EmergencyMedicalCard,
): Pick<EmergencyMedicalCard, 'bloodType' | 'allergies'> | null {
  if (!card.shareConsent) return null;
  if (!card.bloodType && !card.allergies) return null;
  return { bloodType: card.bloodType, allergies: card.allergies };
}

export function useEmergencyMedicalCard(): UseEmergencyMedicalCard {
  const [card, setCard] = useState<EmergencyMedicalCard>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    get<EmergencyMedicalCard>(STORAGE_KEY)
      .then((stored) => {
        if (alive && stored) setCard({ ...EMPTY, ...stored });
      })
      .catch((err) => logger.warn('useEmergencyMedicalCard: load failed', { err }))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const saveCard = useCallback(
    async (patch: Partial<EmergencyMedicalCard>): Promise<EmergencyMedicalCard> => {
      const merged: EmergencyMedicalCard = {
        ...card,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      setCard(merged);
      try {
        await set(STORAGE_KEY, merged);
      } catch (err) {
        logger.warn('useEmergencyMedicalCard: save failed', { err });
      }
      return merged;
    },
    [card],
  );

  return {
    card,
    loading,
    saveCard,
    hasShareableCard: shareableCard(card) !== null,
  };
}
