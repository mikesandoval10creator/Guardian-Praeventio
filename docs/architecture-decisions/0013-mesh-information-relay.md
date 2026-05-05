# ADR 0013 — Mesh Information Relay (Bluetooth/Wi-Fi Direct + DTN/ICN)

Status: **accepted** (visión arquitectónica core del producto)
Date: 2026-05-05
Aplica a: emergencias, sincronización offline de Zettelkasten, propagación
viral de archivos, ubicación de compañeros sin internet

## Contexto

Cuando hay terremoto, derrumbe minero, tsunami, incendio mayor — la
infraestructura de internet se cae. Justamente cuando MÁS se necesita:

- Saber dónde están los compañeros para rescatarlos
- Notificar al supervisor un incidente
- Acceder al PTS (procedimiento de trabajo seguro) o al afiche normativo
- Confirmar evacuación de la cuadrilla

Una app de prevención que depende del cloud para responder en estos
momentos es inútil cuando cuenta. Praeventio debe seguir funcionando.

## La visión técnica

**Store-carry-forward + content-addressed mesh**: cuando dos celulares
con la app entran en proximidad Bluetooth/Wi-Fi Direct (10-100m), se
intercambian automáticamente:

1. **Migajas GPS** — última ubicación conocida de cada trabajador del proyecto
2. **Solicitudes pendientes** — un trabajador pidió ver el "PTS soldadura"
   y aún no llega
3. **Archivos en relay** — paquetes del Zettelkasten que están en camino
   hacia algún destinatario
4. **Eventos hacia supervisor** — incidente reportado, evacuación
   activada, SOS

El primer dispositivo que vuelve a tener internet:
- Sube todos los eventos pendientes al servidor (lo que ya hace
  `OfflineSyncStateMachine`)
- Descarga los archivos solicitados que se acumularon en la mesh
- Los vuelve a inyectar al mesh para que se propaguen a quien los pidió

**Efecto cadena / dominó**: el trabajador que está al fondo de la
mina sin señal recibe el PTS porque otro trabajador subió a superficie,
sincronizó, bajó, y le pasó el archivo cuando se cruzaron en el túnel.

## Decisión técnica

### Stack de transporte

| Capa | Tecnología | Cuándo se usa |
|---|---|---|
| 1. Discovery | Bluetooth LE Scan / GATT | Siempre activo en background |
| 2. Mensajes cortos | Bluetooth LE GATT (1-512 bytes) | Migajas GPS, requests, ACKs |
| 3. Archivos pequeños | Bluetooth LE chunked (< 1MB) | Afiches, fragmentos PTS |
| 4. Archivos grandes | Wi-Fi Direct on-demand | PTS completo, video corto del incidente |
| 5. Validation comercial | Bridgefy SDK | Sprint 26 piloto |
| 6. Producción | Protocolo propio open-source | Sprint 27+ |

### Modelo de datos — Mesh Packet

Cada paquete viaja independiente. Es self-contained, content-addressed,
firmado. El nodo intermediario NO necesita confiar en el remitente —
puede verificar la firma.

```ts
interface MeshPacket {
  // Identidad y direccionamiento
  id: string;                    // hash SHA-256 del payload (content-addressed)
  type: 'gps_breadcrumb' | 'file_request' | 'file_chunk' | 'event_to_supervisor' | 'sos' | 'ack';
  fromUid: string;               // worker UID original (no cambia con relay)
  toUid: string | 'broadcast' | 'supervisors';
  
  // Routing (ICN-style)
  ttl: number;                   // hops remaining; decrementa en cada salto
  hopCount: number;              // diagnostic
  bornAtMs: number;
  expiresAtMs: number;
  
  // Payload
  payload: unknown;              // depends on type
  
  // Cryptographic integrity
  signature: string;             // sign(fromUid, payload) con worker passkey
  signaturePublicKeyId: string;  // qué passkey usó
  
  // Relay tracking (para evitar loops + dedup)
  relayedBy: string[];           // UIDs que ya vieron este paquete
  
  // Priority (para ordering en bandwidth limitada)
  priority: 'sos' | 'high' | 'normal' | 'low';
}
```

### Tipos de paquete

#### 1. `gps_breadcrumb` — Migaja GPS

```ts
{
  type: 'gps_breadcrumb',
  payload: {
    workerUid: string,
    lat: number, lng: number,
    accuracyM: number,
    capturedAtMs: number,
    projectId: string,
  }
}
```

- TTL: 4 hops
- Expira: 6 horas
- Priority: high
- Broadcast a todos en proximidad
- Al recibir: cada celular guarda en `local_breadcrumbs/{projectId}/{workerUid}` la última posición conocida del compañero. Si emergencia → mapa muestra pin con timestamp "visto hace 12 min en X coord".

#### 2. `file_request` — Pedido de archivo del ZK

```ts
{
  type: 'file_request',
  payload: {
    requesterUid: string,
    nodeId: string,              // ID del nodo Zettelkasten
    contentHash: string,         // hash del archivo deseado (puede ser null)
    title: string,               // "PTS soldadura altura"
  }
}
```

- TTL: 8 hops
- Expira: 24 horas
- Priority: high
- Broadcast — cualquier nodo que tenga el archivo localmente lo
  empieza a chunkear y enviar (`file_chunk` packets) al requester.
- Cualquier nodo con internet ve la request → descarga del server →
  cachea local → empieza a chunkear y enviar.
- Si nadie tiene el archivo, la request sigue propagándose hasta TTL=0.

#### 3. `file_chunk` — Trozo de archivo en tránsito

```ts
{
  type: 'file_chunk',
  payload: {
    requestId: string,           // matchea el file_request
    contentHash: string,
    chunkIndex: number,
    totalChunks: number,
    data: Uint8Array,            // ~64KB max por paquete BT, 1MB por Wi-Fi Direct
  }
}
```

- TTL: 12 hops (pueden tomar caminos diferentes los chunks)
- Expira: 1 hora
- Priority: normal
- El requester reconstruye el archivo cuando recibe TODOS los chunks.

#### 4. `event_to_supervisor` — Notificación urgente sin internet

```ts
{
  type: 'event_to_supervisor',
  toUid: 'supervisors',
  payload: {
    eventType: 'incident' | 'evacuation' | 'medical' | 'leak' | 'fire',
    workerUid: string,
    location: { lat, lng, accuracyM },
    capturedAtMs: number,
    description: string,
    photoHash?: string,          // si hay foto adjunta como file_chunks
  }
}
```

- TTL: 12 hops
- Expira: 24 horas
- Priority: high
- Cualquier supervisor del proyecto que entre en proximidad → recibe
  notificación local + cuando vuelva a tener internet sube a servidor
  → multicast FCM a todos los demás supervisors.

#### 5. `sos` — Petición de ayuda crítica

```ts
{
  type: 'sos',
  toUid: 'broadcast',
  payload: {
    workerUid: string,
    location: { lat, lng, accuracyM },
    capturedAtMs: number,
    triggerReason: 'fall_detected' | 'manual' | 'man_down_timeout' | 'no_response',
  }
}
```

- TTL: 16 hops (queremos máxima propagación)
- Expira: 48 horas
- Priority: **sos** (preempts everything)
- TODOS los celulares en proximidad pitan + muestran banner "SOS de
  Juan a 200m al sur" + lo propagan inmediatamente.
- El primer dispositivo con internet → POST `/api/emergency/sos` con
  retry hasta confirm.

#### 6. `ack` — Confirmación de recepción

```ts
{
  type: 'ack',
  payload: {
    ackedPacketId: string,
    confirmedBy: string,         // workerUid o 'server'
  }
}
```

- TTL: 4 hops
- Expira: 1 hora
- Priority: normal
- Sirve para que el remitente original sepa que su mensaje llegó.
- Si llega ack `server`, la app sabe que ya está en cloud y puede
  borrar la copia local.

### Dedup + loop avoidance

Cada paquete tiene `id = SHA-256(payload + fromUid + bornAtMs)`. El
nodo mantiene un Bloom filter de IDs vistos en últimas 6h. Si llega
un paquete con ID conocido → no se relaya (loop detection). Si está
en `relayedBy[]` el propio UID → no se relaya (cycle).

### Bandwidth budgeting

Bluetooth LE entrega ~10 KB/s sustained. Wi-Fi Direct ~10 MB/s. La cola
de packets se ordena por priority + age. SOS preempts. Mientras dos
dispositivos están en proximidad, drenan packets en orden hasta timeout
(usuario se aleja → conexión se cae → la cola se preserva para próximo
encuentro).

### Privacy + autorization

- Solo workers del MISMO project intercambian packets útiles.
  Verificación por `projectId` en payload — si no coincide con
  `useProject().selectedProject?.id` del receptor, paquete se descarta.
- Encryption: payload encriptado con shared project key derivado del
  `projectId` + `tenantId`. Workers de project A NO pueden decodear
  packets de project B aunque estén en mismo edificio.
- Signature: `signature` evita que un atacante inyecte SOS falsos
  con UIDs robados. Verificación contra passkey del worker.

### Stack de implementación

#### Sprint 26 — Bridgefy SDK piloto (validación comercial)

- Bridgefy es comercial pero gratis hasta 10K usuarios mes.
- Maneja Bluetooth + Wi-Fi automático.
- Adapter `BridgefyTransport` implementa interface `MeshTransport`.
- Validación end-to-end con beta users en faena real.

#### Sprint 27 — Protocolo propio open-source

- Capacitor plugin custom: `@praeventio/capacitor-mesh`.
- Bluetooth LE GATT: server (advertise) + client (scan/connect).
- Service UUID propio: `00001234-praeventio-guardian-mesh-uuid`.
- Wi-Fi Direct: solo para chunks > 100KB (negociación on-demand).
- Adapter `PraeventioMeshTransport` reemplaza Bridgefy si decisión
  comercial cambia.

#### Sprint 28 — Optimization

- Wi-Fi Aware (Android 8+) para discovery sin pairing.
- ULTRA-low-power BLE advertising en background (1mA continuous).
- Mesh density optimization — si N nodos en proximidad, no todos
  relayan los mismos packets (gossip protocol con probability).

## Engine puro (testeable)

`src/services/mesh/meshPacket.ts` (Sprint 25 — esta entrega):
- Helper functions para crear, firmar, verificar packets
- Dedup con Bloom filter
- TTL/expiry checks
- Priority queue

`src/services/mesh/meshRelayQueue.ts` (Sprint 25):
- Store-carry-forward queue persistido en IndexedDB
- Drain logic cuando llega peer
- Cleanup de packets expirados

`src/services/mesh/meshRequestRouter.ts` (Sprint 26):
- File request lifecycle (pending → in_transit → complete | expired)
- Cache de archivos populares localmente (si todos piden PTS soldadura,
  basta que UN nodo tenga el archivo y lo propague)

`src/services/mesh/transports/` (Sprint 26+):
- `bridgefyTransport.ts` (Sprint 26 piloto)
- `praeventioBleTransport.ts` (Sprint 27)
- `wifiDirectTransport.ts` (Sprint 27+)

## Casos de uso end-to-end

### Caso 1 — Trabajador pide PTS sin internet

1. Juan en mina subterránea sin señal abre la app, busca "PTS soldadura
   altura". App detecta cache local miss.
2. App genera `file_request` packet con TTL=8.
3. Juan se cruza en pasillo con Pedro (15s de proximidad). Bluetooth
   GATT intercambia: Pedro recibe el `file_request`. Pedro tampoco
   tiene el archivo, pero relaya con TTL=7.
4. Pedro sube a superficie 30 min después. Su app se conecta a 4G.
   Detecta el `file_request` en su cola → descarga del servidor el
   archivo → cachea local → genera `file_chunk` packets con `requestId`
   matchea.
5. Pedro vuelve a bajar. Se cruza con Juan. Bluetooth chunked transfer
   le envía los `file_chunk` packets a Juan.
6. Juan recibe todos los chunks → reconstruye el archivo → lo abre.
   App marca request como complete + envía `ack`.

Tiempo total: ~30-40 min. Sin internet en ningún momento del lado de
Juan. Trabajador de mina recibió PTS sin haber subido.

### Caso 2 — Localización de compañero post-derrumbe

1. Derrumbe en sector C-5. Carlos no responde radio ni cellphone.
2. App de Carlos seguía emitiendo `gps_breadcrumb` cada 60s antes del
   derrumbe (ground truth: 12:42 PM, lat -33.4, lng -70.6, accuracy 8m).
3. Otros trabajadores que cruzaron cerca de Carlos en últimas 6h ya
   tienen ese breadcrumb cached en sus apps.
4. Supervisor pide a la app: "última posición conocida de Carlos".
5. App agrega de su cache local + breadcrumbs sincronizados de
   compañeros + última cloud sync = "Carlos visto hace 38 min en
   sector C-5, profundidad estimada 80m, accuracy 8m".
6. Equipo de rescate va directo al punto.

### Caso 3 — Notificación de evacuación al supervisor

1. Cuadrilla de Marcos detecta fuga de gas en zona Z-3. Sin internet.
2. Marcos genera `event_to_supervisor` con tipo `leak`, location, foto.
3. Foto se chunked en `file_chunk` packets.
4. Cuadrilla evacua hacia salida sur. En el camino se cruzan con la
   cuadrilla de Diego que se dirige a Z-3 ignorando peligro.
5. Bluetooth GATT entre los dos celulares: la cuadrilla de Diego
   recibe el evento + la foto. App alerta visual + sonora a Diego:
   "🚨 Marcos reportó fuga de gas en Z-3 — desvía ruta".
6. Diego cambia de ruta. La cadena de mando reactiva sucedió SIN
   internet, en 3 minutos.
7. Cuando Marcos llega a superficie y conecta → POST a `/api/emergency`
   sube el evento + foto al servidor → multicast FCM a todos los
   supervisores.

## Consecuencias

### Operacionales

- App sigue salvando vidas cuando cae internet.
- Cumple norma chilena Anexo X DS 132 (mining): comunicación interna
  redundante en faena subterránea.
- Diferenciador comercial enorme: NINGUNA otra plataforma chilena de
  prevención hace mesh.

### Técnicas

- Battery: BLE advertising background ~1mA, scanning ~5mA. ~3-5%
  battery/hour adicional. Aceptable.
- Storage: queue local 50MB max (rolling cleanup).
- Privacy: project-key encryption + signature mantienen integridad
  end-to-end. Workers de otros tenants NO pueden interceptar.

### Legales

- ✅ Ley 19.628 + 21.719: encryption + signature por trabajador.
- ✅ Ley 16.744: mejora capacidad de respuesta a accidentes.
- ✅ DS 132 (minería): satisface "comunicación interna redundante".
- ✅ Coherente con ADR 0010: solo se intercambian datos legítimos
  de faena (location durante turno, eventos, archivos del ZK públicos
  del proyecto).

### Filosóficas

- "Cuando hay desastre, la app no muere — sobrevive en los celulares"
- "Cada trabajador es nodo que ayuda a otros aunque no se conozcan"
- "El conocimiento del Zettelkasten es viral — fluye por proximidad
  física igual que las personas se ayudan en faena"

Esto materializa la cosmología "uno es todo y todos uno" que
mencionaste: cada celular es a la vez una entidad distinguible y un
nodo del todo. La información circula por la red de personas.

## Migration path

### Sprint 25 (esta entrega)

✅ ADR 0013 documenta visión completa
✅ `meshPacket.ts` — modelo + sign/verify/dedup (función pura)
✅ `meshRelayQueue.ts` — store-carry-forward queue (sin transport)
✅ Tests unitarios

### Sprint 26 — Piloto Bridgefy

- Capacitor plugin Bridgefy adapter
- UI de "Modo malla" en settings
- Beta closed con 5-10 usuarios de mineras
- Métricas reales de propagación

### Sprint 27 — Protocolo propio

- `@praeventio/capacitor-mesh` plugin custom
- Service UUID registrado
- Reemplazo gradual de Bridgefy

### Sprint 28+ — Wi-Fi Direct + density optimization

- Wi-Fi Aware
- Gossip protocol con probability
- Compression + delta encoding

## Referencias

- ADR 0010 (privacy by design)
- ADR 0011 (twin triple-gate)
- ADR 0012 (health vault sovereignty)
- Sprint 25 QQ (`syncStateMachine.ts` — server sync, complementario)
- DS 132 minería Chile (comunicación faena)
- IETF DTNRG (Delay-Tolerant Networking Research Group)
- ICN (Information-Centric Networking) — NDN papers
- Bridgefy SDK docs
- Bluetooth Mesh Profile 1.1 (no usamos directamente, referencia)
