package com.laundryloop.printbridge

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Remotely managed POS access using the existing Netlify hosting suspension flag.
 *
 * The source of truth is GET https://thelaundryloop.net/api/pos-access.
 * The server returns only { "suspended": boolean }; no billing information
 * or administrator credentials are ever stored in the client.
 *
 * After successful online approval, offline work is allowed for at most
 * 24 hours. A confirmed suspension persists until a subsequent confirmed
 * active response. A network failure never clears a suspension.
 */
internal class RemotePosAccess(
    context: Context,
    private val onStateChanged: (State) -> Unit,
) {
    enum class State { ALLOWED, SUSPENDED, CONNECTION_REQUIRED }

    private val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val handler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private var running = false
    private var requestInFlight = false
    private val poll = Runnable { refresh() }

    fun start() {
        if (running) return
        running = true
        onStateChanged(cachedState())
        refresh()
    }

    fun stop() {
        running = false
        handler.removeCallbacks(poll)
    }

    fun close() {
        stop()
        executor.shutdownNow()
    }

    fun retryNow() {
        if (running) refresh()
    }

    private fun cachedState(): State {
        if (preferences.getBoolean(KEY_SUSPENDED, false)) return State.SUSPENDED
        val expiresAt = preferences.getLong(KEY_ALLOWED_UNTIL, 0L)
        return if (expiresAt > System.currentTimeMillis()) State.ALLOWED
        else State.CONNECTION_REQUIRED
    }

    private fun refresh() {
        handler.removeCallbacks(poll)
        if (!running || requestInFlight) return
        requestInFlight = true

        executor.execute {
            val serverSuspended = fetchServerStatus()
            handler.post {
                requestInFlight = false
                if (!running) return@post

                if (serverSuspended != null) {
                    if (serverSuspended) {
                        // Keep the denial sticky across restarts and disconnections.
                        preferences.edit()
                            .putBoolean(KEY_SUSPENDED, true)
                            .putLong(KEY_ALLOWED_UNTIL, 0L)
                            .apply()
                    } else {
                        preferences.edit()
                            .putBoolean(KEY_SUSPENDED, false)
                            .putLong(KEY_ALLOWED_UNTIL, System.currentTimeMillis() + OFFLINE_LEASE_MS)
                            .apply()
                    }
                }

                onStateChanged(cachedState())
                handler.postDelayed(poll, POLL_INTERVAL_MS)
            }
        }
    }

    private fun fetchServerStatus(): Boolean? {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(ACCESS_URL).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 3500
                readTimeout = 3500
                useCaches = false
                instanceFollowRedirects = false
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Cache-Control", "no-cache")
            }
            if (connection.responseCode != HttpURLConnection.HTTP_OK) return null
            val payload = connection.inputStream.bufferedReader().use { it.readText() }
            val parsed = JSONObject(payload)
            if (!parsed.has("suspended") || parsed.isNull("suspended")) return null
            parsed.getBoolean("suspended")
        } catch (_: Exception) {
            // Reuse the last verified lease; never infer "allowed" from failure.
            null
        } finally {
            connection?.disconnect()
        }
    }

    companion object {
        private const val ACCESS_URL = "https://thelaundryloop.net/api/pos-access"
        private const val PREFS = "laundry-loop-native-pos-access-v1"
        private const val KEY_SUSPENDED = "last_verified_suspended"
        private const val KEY_ALLOWED_UNTIL = "allowed_until_epoch_ms"
        private const val POLL_INTERVAL_MS = 60_000L
        private const val OFFLINE_LEASE_MS = 24L * 60L * 60L * 1000L
    }
}
