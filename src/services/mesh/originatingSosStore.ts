import { deleteEncrypted, getEncrypted, listEncryptedKeys, setEncrypted } from '../security/encryptedKvStore';
import { isPacketAlive, type MeshPacket } from './meshPacket';
import type { OriginatingSosStore } from './transportFacade';

// Separate records avoid a shared read/overwrite index across browser tabs.
export function createOriginatingSosStore(uid: string, projectId: string): OriginatingSosStore {
  const prefix = `mesh-origin-sos:v1:${JSON.stringify([uid, projectId])}:`;
  const belongs = (packet: MeshPacket) =>
    packet.type === 'sos' && packet.fromUid === uid && packet.projectId === projectId;
  return {
    async load() {
      const packets: MeshPacket[] = [];
      for (const key of await listEncryptedKeys()) {
        if (!key.startsWith(prefix)) continue;
        const packet = await getEncrypted<MeshPacket>(key);
        if (!packet || !belongs(packet) || key !== prefix + packet.id) continue;
        if (!isPacketAlive(packet)) {
          await deleteEncrypted(key);
          continue;
        }
        packets.push(packet);
      }
      return packets;
    },
    async save(packet) {
      if (belongs(packet) && isPacketAlive(packet)) await setEncrypted(prefix + packet.id, packet);
    },
    remove: (id) => deleteEncrypted(prefix + id),
  };
}
