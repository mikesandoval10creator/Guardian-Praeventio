// SPDX-License-Identifier: MIT
//
// @praeventio/capacitor-mesh — Android Plugin (Sprint 46 REAL BLE GATT).
//
// Reemplaza el STUB Sprint 30 con implementación BLE GATT real:
//   - BluetoothLeAdvertiser anunciando service UUID + manufacturer data
//     (peerIdHash[4] || projectIdHash[4]).
//   - BluetoothLeScanner con ScanFilter por service UUID, dedupe Set<String>,
//     y timeout 30s para emitir mesh:peer-lost.
//   - BluetoothGattServer expone characteristic `mesh-data`
//     (WRITE / WRITE_NO_RESPONSE, chunks 512 bytes, reassembly por peer).
//   - BluetoothGatt client conecta a cada peer descubierto, reuso
//     vía Map<String, BluetoothGatt>.
//   - send(packet): serializa JSON, chunks 512B, write a cada GATT;
//     deliveredTo = SUCCESS; queued = resto.
//   - Permission gating: API 31+ BLUETOOTH_SCAN/ADVERTISE/CONNECT,
//     API ≤30 ACCESS_FINE_LOCATION + BLUETOOTH/BLUETOOTH_ADMIN.
//   - Lifecycle: stop() + onDestroy() cancelan advertising/scan y cierran
//     todos los GATT clients/server.
//
// El SERVICE_UUID textual `00001234-PRAE-VENTI-O123-456789ABCDEF` es la
// marca canónica del proyecto pero no es un UUID hex válido (contiene
// P/R/V/N/T/I/O y la longitud del 3er grupo no es 4). Para uso BLE real
// se deriva BLE_SERVICE_UUID mapeando los chars no-hex de forma
// determinística (P→1 R→2 V→3 N→4 T→5 I→6 O→7) y ajustando longitudes
// para cumplir el formato 8-4-4-4-12.

package com.praeventio.mesh

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

@CapacitorPlugin(name = "Mesh")
class MeshPlugin : Plugin() {
    companion object {
        private const val TAG = "PraeventioMesh"

        /** Marca canónica del proyecto (símbolo, no es UUID hex válido). */
        const val SERVICE_UUID = "00001234-PRAE-VENTI-O123-456789ABCDEF"

        /** UUID válido derivado para BLE real. */
        private const val BLE_SERVICE_UUID_STR =
            "00001234-12AE-3E45-7123-456789ABCDEF"

        /** Characteristic `mesh-data` — WRITE_NO_RESPONSE, 512-byte chunks. */
        private const val MESH_DATA_UUID_STR =
            "0000ABCD-12AE-3E45-7123-456789ABCDEF"

        private val BLE_SERVICE_UUID: UUID = UUID.fromString(BLE_SERVICE_UUID_STR)
        private val MESH_DATA_UUID: UUID = UUID.fromString(MESH_DATA_UUID_STR)

        private const val CHUNK_SIZE = 512
        /** Manufacturer ID arbitrario reservado para Praeventio (no IEEE-asignado). */
        private const val MANUFACTURER_ID = 0x0DA0
        /** Si no vemos un peer en este intervalo emitimos peer-lost. */
        private const val PEER_LOST_TIMEOUT_MS = 30_000L
        private const val PEER_CHECK_INTERVAL_MS = 5_000L
    }

    // ---- Estado del plugin -------------------------------------------------

    private var active: Boolean = false
    private var peerId: String? = null
    private var projectId: String? = null
    private var packetsRelayed: Int = 0
    private val mainHandler = Handler(Looper.getMainLooper())

    private var btAdapter: BluetoothAdapter? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var scanner: BluetoothLeScanner? = null
    private var gattServer: BluetoothGattServer? = null

    /** peerAddress (MAC) → último RSSI visto. */
    private val knownPeers = ConcurrentHashMap<String, Int>()
    /** peerAddress → timestamp del último ScanResult. */
    private val lastSeen = ConcurrentHashMap<String, Long>()
    /** peerAddress → cliente GATT conectado. */
    private val gattClients = ConcurrentHashMap<String, BluetoothGatt>()
    /** Reassembly buffer por peer (para chunks). */
    private val rxBuffers = ConcurrentHashMap<String, StringBuilder>()

    // ---- Capacitor plugin methods -----------------------------------------

    @PluginMethod
    fun start(call: PluginCall) {
        peerId = call.getString("peerId")
        projectId = call.getString("projectId")
        if (peerId.isNullOrBlank() || projectId.isNullOrBlank()) {
            call.reject("peerId and projectId are required")
            return
        }
        val ctx = context ?: run {
            call.reject("Plugin context unavailable")
            return
        }
        val missing = checkPermissions(ctx)
        if (missing != null) {
            call.reject("PERMISSION_REQUIRED: $missing")
            return
        }
        val mgr = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = mgr?.adapter
        if (adapter == null || !adapter.isEnabled) {
            call.reject("BLUETOOTH_DISABLED")
            return
        }
        btAdapter = adapter
        advertiser = adapter.bluetoothLeAdvertiser
        scanner = adapter.bluetoothLeScanner
        if (advertiser == null || scanner == null) {
            call.reject("BLE_NOT_SUPPORTED")
            return
        }

        try {
            startGattServer(ctx, mgr)
            startAdvertising()
            startScanning()
            schedulePeerWatchdog()
        } catch (sec: SecurityException) {
            call.reject("PERMISSION_REQUIRED: ${sec.message}")
            return
        } catch (t: Throwable) {
            Log.e(TAG, "start() failed", t)
            call.reject("BLE_START_FAILED: ${t.message}")
            return
        }

        active = true
        packetsRelayed = 0
        Log.i(TAG, "start(peerId=$peerId, projectId=$projectId) — Sprint 46 real BLE")
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        Log.i(TAG, "stop() — Sprint 46 real BLE")
        teardown()
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val packet = call.data
        val packetId = packet.optString("id")
        Log.i(TAG, "send() packetId=$packetId peers=${gattClients.size}")

        val delivered = JSArray()
        val queued = JSArray()

        if (!active) {
            call.resolve(JSObject().apply {
                put("deliveredTo", delivered)
                put("queued", queued)
            })
            return
        }

        val payload = packet.toString().toByteArray(StandardCharsets.UTF_8)
        val chunks = chunkify(payload)
        val snapshot = gattClients.toMap()
        for ((addr, gatt) in snapshot) {
            val ok = writeChunks(gatt, chunks)
            if (ok) {
                delivered.put(addr)
                packetsRelayed += 1
            } else {
                queued.put(addr)
            }
        }

        call.resolve(JSObject().apply {
            put("deliveredTo", delivered)
            put("queued", queued)
        })
    }

    @PluginMethod
    fun getState(call: PluginCall) {
        val peers = JSArray()
        for ((addr, rssi) in knownPeers) {
            peers.put(JSObject().apply {
                put("id", addr)
                put("rssi", rssi)
            })
        }
        val state = JSObject().apply {
            put("active", active)
            put("peers", peers)
            put("packetsRelayed", packetsRelayed)
        }
        call.resolve(state)
    }

    override fun handleOnDestroy() {
        teardown()
        super.handleOnDestroy()
    }

    // ---- Permission gating ------------------------------------------------

    private fun checkPermissions(ctx: Context): String? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val need = listOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
            )
            val missing = need.filter {
                ctx.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
            }
            if (missing.isEmpty()) null else missing.joinToString(",")
        } else {
            if (ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED
            ) Manifest.permission.ACCESS_FINE_LOCATION else null
        }
    }

    // ---- Advertising -------------------------------------------------------

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartFailure(errorCode: Int) {
            Log.w(TAG, "Advertise failed: $errorCode")
        }
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            Log.i(TAG, "Advertise started")
        }
    }

    private fun startAdvertising() {
        val adv = advertiser ?: return
        val pid = peerId ?: return
        val proj = projectId ?: return

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(true)
            .build()

        // manufacturer data: peerIdHash[4] || projectIdHash[4]
        val buf = ByteBuffer.allocate(8)
        buf.putInt(pid.hashCode())
        buf.putInt(proj.hashCode())

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(ParcelUuid(BLE_SERVICE_UUID))
            .addManufacturerData(MANUFACTURER_ID, buf.array())
            .build()

        adv.startAdvertising(settings, data, advertiseCallback)
    }

    private fun stopAdvertising() {
        try {
            advertiser?.stopAdvertising(advertiseCallback)
        } catch (t: Throwable) {
            Log.w(TAG, "stopAdvertising ignored: ${t.message}")
        }
    }

    // ---- Scanning ---------------------------------------------------------

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device ?: return
            val addr = device.address ?: return
            val rssi = result.rssi
            val isNew = !knownPeers.containsKey(addr)
            knownPeers[addr] = rssi
            lastSeen[addr] = System.currentTimeMillis()
            if (isNew) {
                mainHandler.post {
                    notifyListeners("mesh:peer-discovered", JSObject().apply {
                        put("id", addr)
                        put("rssi", rssi)
                    })
                }
                connectGattClient(device)
            }
        }
        override fun onScanFailed(errorCode: Int) {
            Log.w(TAG, "Scan failed: $errorCode")
        }
    }

    private fun startScanning() {
        val s = scanner ?: return
        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(BLE_SERVICE_UUID))
            .build()
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_BALANCED)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .build()
        s.startScan(listOf(filter), settings, scanCallback)
    }

    private fun stopScanning() {
        try {
            scanner?.stopScan(scanCallback)
        } catch (t: Throwable) {
            Log.w(TAG, "stopScan ignored: ${t.message}")
        }
    }

    private fun schedulePeerWatchdog() {
        mainHandler.postDelayed(object : Runnable {
            override fun run() {
                if (!active) return
                val now = System.currentTimeMillis()
                val lost = lastSeen.entries
                    .filter { now - it.value > PEER_LOST_TIMEOUT_MS }
                    .map { it.key }
                for (addr in lost) {
                    knownPeers.remove(addr)
                    lastSeen.remove(addr)
                    gattClients.remove(addr)?.let {
                        try { it.close() } catch (_: Throwable) {}
                    }
                    rxBuffers.remove(addr)
                    mainHandler.post {
                        notifyListeners("mesh:peer-lost", JSObject().apply {
                            put("id", addr)
                        })
                    }
                }
                mainHandler.postDelayed(this, PEER_CHECK_INTERVAL_MS)
            }
        }, PEER_CHECK_INTERVAL_MS)
    }

    // ---- GATT Server ------------------------------------------------------

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice?,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic?,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?,
        ) {
            val addr = device?.address ?: return
            if (characteristic?.uuid != MESH_DATA_UUID) return
            val bytes = value ?: ByteArray(0)
            val chunk = String(bytes, StandardCharsets.UTF_8)
            val buf = rxBuffers.getOrPut(addr) { StringBuilder() }
            buf.append(chunk)
            // Heurística: cada packet es JSON completo terminado por '}'
            // y empieza por '{'. Cuando llaves balanceadas, emit + reset.
            if (isBalancedJson(buf)) {
                val raw = buf.toString()
                buf.setLength(0)
                try {
                    val js = JSObject(raw)
                    mainHandler.post {
                        packetsRelayed += 1
                        notifyListeners("mesh:packet", js)
                    }
                } catch (t: Throwable) {
                    Log.w(TAG, "Bad JSON from $addr: ${t.message}")
                }
            }
            if (responseNeeded) {
                try {
                    gattServer?.sendResponse(
                        device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null,
                    )
                } catch (_: SecurityException) {}
            }
        }
    }

    private fun isBalancedJson(buf: StringBuilder): Boolean {
        var depth = 0
        var inStr = false
        var escape = false
        for (c in buf) {
            if (escape) { escape = false; continue }
            if (c == '\\') { escape = true; continue }
            if (c == '"') { inStr = !inStr; continue }
            if (inStr) continue
            if (c == '{') depth += 1
            else if (c == '}') {
                depth -= 1
                if (depth == 0) return true
            }
        }
        return false
    }

    private fun startGattServer(ctx: Context, mgr: BluetoothManager) {
        val server = mgr.openGattServer(ctx, gattServerCallback) ?: return
        val service = BluetoothGattService(
            BLE_SERVICE_UUID,
            BluetoothGattService.SERVICE_TYPE_PRIMARY,
        )
        val characteristic = BluetoothGattCharacteristic(
            MESH_DATA_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE
                or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE,
        )
        service.addCharacteristic(characteristic)
        server.addService(service)
        gattServer = server
    }

    private fun stopGattServer() {
        try {
            gattServer?.close()
        } catch (t: Throwable) {
            Log.w(TAG, "stopGattServer ignored: ${t.message}")
        }
        gattServer = null
    }

    // ---- GATT Client ------------------------------------------------------

    private val gattClientCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(
            gatt: BluetoothGatt?,
            status: Int,
            newState: Int,
        ) {
            val addr = gatt?.device?.address ?: return
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                try { gatt.discoverServices() } catch (_: SecurityException) {}
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                try { gatt.close() } catch (_: Throwable) {}
                gattClients.remove(addr)
            }
        }
    }

    private fun connectGattClient(device: BluetoothDevice) {
        val addr = device.address ?: return
        if (gattClients.containsKey(addr)) return
        val ctx = context ?: return
        try {
            val g = device.connectGatt(ctx, false, gattClientCallback)
            if (g != null) gattClients[addr] = g
        } catch (sec: SecurityException) {
            Log.w(TAG, "connectGatt denied for $addr: ${sec.message}")
        }
    }

    private fun chunkify(payload: ByteArray): List<ByteArray> {
        if (payload.size <= CHUNK_SIZE) return listOf(payload)
        val out = ArrayList<ByteArray>((payload.size + CHUNK_SIZE - 1) / CHUNK_SIZE)
        var i = 0
        while (i < payload.size) {
            val end = minOf(i + CHUNK_SIZE, payload.size)
            out.add(payload.copyOfRange(i, end))
            i = end
        }
        return out
    }

    /**
     * Escribe todos los chunks a un GATT en orden. Devuelve true sólo si TODOS
     * los writes retornaron success (sincrónico-best-effort: el write real es
     * async; Android lo encola y reporta SUCCESS si lo pudo despachar).
     */
    private fun writeChunks(gatt: BluetoothGatt, chunks: List<ByteArray>): Boolean {
        return try {
            val service = gatt.getService(BLE_SERVICE_UUID) ?: return false
            val ch = service.getCharacteristic(MESH_DATA_UUID) ?: return false
            ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
            for (chunk in chunks) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    val rc = gatt.writeCharacteristic(
                        ch, chunk,
                        BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE,
                    )
                    if (rc != BluetoothStatusCodes.SUCCESS) return false
                } else {
                    @Suppress("DEPRECATION")
                    ch.value = chunk
                    @Suppress("DEPRECATION")
                    if (!gatt.writeCharacteristic(ch)) return false
                }
            }
            true
        } catch (sec: SecurityException) {
            false
        } catch (t: Throwable) {
            Log.w(TAG, "writeChunks failed: ${t.message}")
            false
        }
    }

    // ---- Teardown ---------------------------------------------------------

    private fun teardown() {
        active = false
        stopAdvertising()
        stopScanning()
        for ((_, g) in gattClients) {
            try { g.disconnect() } catch (_: Throwable) {}
            try { g.close() } catch (_: Throwable) {}
        }
        gattClients.clear()
        rxBuffers.clear()
        knownPeers.clear()
        lastSeen.clear()
        stopGattServer()
        peerId = null
        projectId = null
        packetsRelayed = 0
    }
}
