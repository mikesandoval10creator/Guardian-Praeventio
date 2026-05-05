// SPDX-License-Identifier: MIT
//
// @praeventio/capacitor-mesh — Android Plugin (Sprint 30 SCAFFOLD).
//
// This is a STUB. It registers the plugin with Capacitor, accepts the
// JS calls (start/stop/send/getState), logs them, and emits a synthetic
// peer-discovered event one second after start so the JS wire can be
// exercised end-to-end in `cap run android` smoke tests.
//
// Sprint 31 will REPLACE this body with the real implementation:
//   - BluetoothLeAdvertiser advertising service UUID
//     00001234-PRAE-VENTI-O123-456789ABCDEF
//   - BluetoothLeScanner with that filter (background via JobScheduler)
//   - BluetoothGattServer exposing the `mesh-data` characteristic
//     (READ + WRITE_NO_RESPONSE, 512-byte chunks)
//   - BluetoothGatt client connect on peer discovery
//   - Permission gating BLUETOOTH_SCAN / BLUETOOTH_ADVERTISE /
//     BLUETOOTH_CONNECT / ACCESS_FINE_LOCATION (legacy)

package com.praeventio.mesh

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "Mesh")
class MeshPlugin : Plugin() {
    companion object {
        private const val TAG = "PraeventioMesh"
        // Sprint 31: real BLE advertising will use this UUID.
        const val SERVICE_UUID = "00001234-PRAE-VENTI-O123-456789ABCDEF"
    }

    private var active: Boolean = false
    private var peerId: String? = null
    private var projectId: String? = null
    private var packetsRelayed: Int = 0
    private val mainHandler = Handler(Looper.getMainLooper())

    @PluginMethod
    fun start(call: PluginCall) {
        peerId = call.getString("peerId")
        projectId = call.getString("projectId")
        if (peerId.isNullOrBlank() || projectId.isNullOrBlank()) {
            call.reject("peerId and projectId are required")
            return
        }
        active = true
        packetsRelayed = 0
        Log.i(TAG, "start(peerId=$peerId, projectId=$projectId) — Sprint 30 stub")

        // Synthetic peer-discovered event so the JS-side wire can be
        // exercised before the real BLE stack lands. Emitted once.
        mainHandler.postDelayed({
            if (active) {
                val peer = JSObject().apply {
                    put("id", "stub-peer-android")
                    put("rssi", -65)
                }
                notifyListeners("mesh:peer-discovered", peer)
            }
        }, 1_000)

        val res = JSObject().apply { put("ok", true) }
        call.resolve(res)
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        Log.i(TAG, "stop() — Sprint 30 stub")
        active = false
        peerId = null
        projectId = null
        packetsRelayed = 0
        val res = JSObject().apply { put("ok", true) }
        call.resolve(res)
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val packet = call.data
        Log.i(TAG, "send() — Sprint 30 stub — packetId=${packet.optString("id")}")
        packetsRelayed += 1
        val res = JSObject().apply {
            put("deliveredTo", JSObject())
            put("queued", JSObject())
        }
        // Capacitor expects arrays as JSArray; Sprint 31 replaces this
        // with real GATT WRITE_NO_RESPONSE ack tracking.
        call.resolve(res)
    }

    @PluginMethod
    fun getState(call: PluginCall) {
        val state = JSObject().apply {
            put("active", active)
            // Empty peer list in stub — Sprint 31 will populate from
            // the BluetoothLeScanner result cache.
            put("peers", org.json.JSONArray())
            put("packetsRelayed", packetsRelayed)
        }
        call.resolve(state)
    }
}
