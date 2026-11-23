package com.expertesim.app

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.provider.Settings
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import org.json.JSONObject

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private val mobilePrefs by lazy { getSharedPreferences("expert_esim", MODE_PRIVATE) }
    private var pendingPermissionAction = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(11, 18, 28)
        window.navigationBarColor = Color.rgb(11, 18, 28)

        webView = WebView(this)
        webView.setBackgroundColor(Color.rgb(11, 18, 28))
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                if (url.isNullOrBlank()) return false
                val uri = Uri.parse(url)
                val isOurSite = uri.scheme == "https" &&
                    uri.host == "expert-esim-web-production.up.railway.app"
                if (isOurSite) return false
                if (uri.scheme == "https" || uri.scheme == "http") {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    return true
                }
                return true
            }
        }
        webView.addJavascriptInterface(ExpertMobileBridge(), "ExpertMobileNative")
        setContentView(webView)
        webView.loadUrl("https://expert-esim-web-production.up.railway.app/")
    }

    override fun onDestroy() {
        webView.removeJavascriptInterface("ExpertMobileNative")
        webView.destroy()
        super.onDestroy()
    }

    private inner class ExpertMobileBridge {
        @JavascriptInterface
        fun getDeviceInfo(): String {
            val hasEuicc = packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_EUICC)
            val euiccEnabled = runCatching {
                getSystemService(android.telephony.euicc.EuiccManager::class.java)?.isEnabled == true
            }.getOrDefault(false)
            val installationId = mobilePrefs.getString("device_installation_id", null)
                ?: java.util.UUID.randomUUID().toString().replace("-", "").also {
                    mobilePrefs.edit().putString("device_installation_id", it).apply()
                }
            val manufacturer = Build.MANUFACTURER?.trim().orEmpty()
            val model = Build.MODEL?.trim().orEmpty()
            val deviceName = listOf(manufacturer, model).filter { it.isNotBlank() }.distinct().joinToString(" ")
            return JSONObject()
                .put("clientDeviceId", "android_" + installationId)
                .put("deviceName", deviceName.ifBlank { "Android device" })
                .put("manufacturer", manufacturer)
                .put("model", model)
                .put("platform", "android")
                .put("osVersion", Build.VERSION.RELEASE ?: "unknown")
                .put("sdkInt", Build.VERSION.SDK_INT)
                .put("eSimSupportKnown", true)
                .put("hasEuiccHardware", hasEuicc)
                .put("euiccEnabled", euiccEnabled)
                .toString()
        }

        @JavascriptInterface
        fun getDeviceHealth(): String {
            val batteryIntent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            val batteryPercent = if (level >= 0 && scale > 0) (level * 100 / scale) else -1
            val batteryStatus = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
            val charging = batteryStatus == BatteryManager.BATTERY_STATUS_CHARGING ||
                batteryStatus == BatteryManager.BATTERY_STATUS_FULL
            val activityManager = getSystemService(ActivityManager::class.java)
            val memory = ActivityManager.MemoryInfo()
            activityManager?.getMemoryInfo(memory)
            val totalMemoryMb = if (memory.totalMem > 0) memory.totalMem / (1024L * 1024L) else 0L
            val availableMemoryMb = memory.availMem / (1024L * 1024L)
            val stats = StatFs(Environment.getDataDirectory().path)
            val totalStorageMb = stats.totalBytes / (1024L * 1024L)
            val availableStorageMb = stats.availableBytes / (1024L * 1024L)
            val thermalStatus = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val power = getSystemService(PowerManager::class.java)
                when (power?.currentThermalStatus) {
                    PowerManager.THERMAL_STATUS_NONE -> "Normal"
                    PowerManager.THERMAL_STATUS_LIGHT -> "Light"
                    PowerManager.THERMAL_STATUS_MODERATE -> "Moderate"
                    PowerManager.THERMAL_STATUS_SEVERE -> "Severe"
                    PowerManager.THERMAL_STATUS_CRITICAL -> "Critical"
                    PowerManager.THERMAL_STATUS_EMERGENCY -> "Emergency"
                    PowerManager.THERMAL_STATUS_SHUTDOWN -> "Shutdown"
                    else -> "Unavailable"
                }
            } else "Unavailable on this Android version"
            return JSONObject()
                .put("batteryPercent", batteryPercent.takeIf { it >= 0 } ?: JSONObject.NULL)
                .put("charging", charging)
                .put("memoryTotalMb", totalMemoryMb)
                .put("memoryAvailableMb", availableMemoryMb)
                .put("storageTotalMb", totalStorageMb)
                .put("storageAvailableMb", availableStorageMb)
                .put("thermalStatus", thermalStatus)
                .put("androidVersion", Build.VERSION.RELEASE ?: "unknown")
                .toString()
        }

        @JavascriptInterface
        fun getCurrentNetworkInfo() {
            runOnUiThread {
                pendingPermissionAction = "networkInfo"
                if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(arrayOf(Manifest.permission.READ_PHONE_STATE), REQUEST_PHONE_STATE)
                } else {
                    sendCurrentNetworkInfo()
                }
            }
        }

        @JavascriptInterface
        fun getPreferredNetwork(): String {
            return JSONObject().put("mode", preferredNetworkMode()).toString()
        }

        @JavascriptInterface
        fun setPreferredNetwork(mode: String) {
            runOnUiThread { applyPreferredNetwork(mode.lowercase()) }
        }

        @JavascriptInterface
        fun openNetworkSettings() {
            runOnUiThread { openAndroidNetworkSettings() }
        }

        @JavascriptInterface
        fun openSimSettings() {
            runOnUiThread { openAndroidSimSettings() }
        }

        @JavascriptInterface
        fun openBatterySettings() {
            runOnUiThread {
                try {
                    startActivity(Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS))
                } catch (error: Exception) {
                    startActivity(Intent(Settings.ACTION_SETTINGS))
                }
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_PHONE_STATE || pendingPermissionAction != "networkInfo") return
        pendingPermissionAction = ""
        if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            sendCurrentNetworkInfo()
        } else {
            reportNetworkInfo(
                "Permission required",
                message = "Android did not grant phone-state access, so the current radio technology cannot be read."
            )
        }
    }

    private fun preferredNetworkMode(): String {
        return mobilePrefs.getString("preferred_network", "auto") ?: "auto"
    }

    private fun applyPreferredNetwork(mode: String) {
        if (mode !in listOf("auto", "4g", "5g")) {
            reportNetworkMode(false, mode, "Unknown network selection.")
            return
        }
        mobilePrefs.edit().putString("preferred_network", mode).apply()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            reportNetworkMode(
                false, mode,
                "This Android version does not let this app apply a direct radio-mode change. Your preference is saved; use Android SIM settings."
            )
            return
        }
        try {
            val baseManager = getSystemService(TelephonyManager::class.java)
                ?: throw IllegalStateException("Android telephony service is unavailable.")
            val defaultDataId = SubscriptionManager.getDefaultDataSubscriptionId()
            val manager = if (defaultDataId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
                baseManager.createForSubscriptionId(defaultDataId)
            } else {
                baseManager
            }
            val lte = TelephonyManager.NETWORK_TYPE_BITMASK_LTE
            val allowed = when (mode) {
                "4g" -> lte
                "5g" -> lte or TelephonyManager.NETWORK_TYPE_BITMASK_NR
                else -> {
                    TelephonyManager.NETWORK_TYPE_BITMASK_GSM or
                        TelephonyManager.NETWORK_TYPE_BITMASK_GPRS or
                        TelephonyManager.NETWORK_TYPE_BITMASK_EDGE or
                        TelephonyManager.NETWORK_TYPE_BITMASK_UMTS or
                        TelephonyManager.NETWORK_TYPE_BITMASK_HSDPA or
                        TelephonyManager.NETWORK_TYPE_BITMASK_HSUPA or
                        TelephonyManager.NETWORK_TYPE_BITMASK_HSPA or
                        TelephonyManager.NETWORK_TYPE_BITMASK_HSPAP or
                        lte or
                        TelephonyManager.NETWORK_TYPE_BITMASK_NR or
                        TelephonyManager.NETWORK_TYPE_BITMASK_IWLAN
                }
            }
            manager.setAllowedNetworkTypesForReason(TelephonyManager.ALLOWED_NETWORK_TYPES_REASON_USER, allowed)
            val message = when (mode) {
                "4g" -> "Android accepted a 4G LTE preference for the currently selected mobile-data SIM."
                "5g" -> "Android accepted a 5G preference with LTE fallback for the currently selected mobile-data SIM. Actual 5G still depends on carrier coverage and plan."
                else -> "Android reset the currently selected mobile-data SIM to automatic network selection."
            }
            reportNetworkMode(true, mode, message)
        } catch (security: SecurityException) {
            reportNetworkMode(
                false, mode,
                "Android or the carrier denied direct radio-mode control. Your selection is saved but the network was not changed."
            )
        } catch (unsupported: UnsupportedOperationException) {
            reportNetworkMode(
                false, mode,
                "This phone or carrier does not expose direct network-mode control. Your selection is saved but was not applied."
            )
        } catch (error: Exception) {
            reportNetworkMode(false, mode, error.message ?: "Android could not apply the requested network mode.")
        }
    }

    private fun sendCurrentNetworkInfo() {
        try {
            val baseManager = getSystemService(TelephonyManager::class.java)
            if (baseManager == null) {
                reportNetworkInfo("Unavailable", message = "Android telephony service is unavailable.")
                return
            }
            val defaultDataSubscription = SubscriptionManager.getDefaultDataSubscriptionId()
            val manager = if (defaultDataSubscription != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
                baseManager.createForSubscriptionId(defaultDataSubscription)
            } else {
                baseManager
            }
            val type = manager.dataNetworkType
            val label = when (type) {
                TelephonyManager.NETWORK_TYPE_NR -> "5G"
                TelephonyManager.NETWORK_TYPE_LTE -> "4G LTE"
                TelephonyManager.NETWORK_TYPE_HSPA,
                TelephonyManager.NETWORK_TYPE_HSPAP,
                TelephonyManager.NETWORK_TYPE_HSDPA,
                TelephonyManager.NETWORK_TYPE_HSUPA -> "3G HSPA"
                TelephonyManager.NETWORK_TYPE_UMTS -> "3G UMTS"
                TelephonyManager.NETWORK_TYPE_EDGE -> "2G EDGE"
                TelephonyManager.NETWORK_TYPE_GPRS -> "2G GPRS"
                TelephonyManager.NETWORK_TYPE_GSM -> "2G GSM"
                else -> "Network type unavailable"
            }
            reportNetworkInfo(
                label,
                hasRadio = packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_RADIO_ACCESS),
                supports5g = type == TelephonyManager.NETWORK_TYPE_NR,
                message = "Network technology is read from the phone's current default mobile-data SIM."
            )
        } catch (security: SecurityException) {
            reportNetworkInfo(
                "Permission required",
                message = "Android denied access to current mobile network information."
            )
        } catch (error: Exception) {
            reportNetworkInfo(
                "Network type unavailable",
                message = error.message ?: "Could not read the active mobile network."
            )
        }
    }

    private fun reportNetworkMode(applied: Boolean, mode: String, message: String) {
        val payload = JSONObject()
            .put("ok", applied)
            .put("applied", applied)
            .put("pending", false)
            .put("mode", mode)
            .put("message", message)
            .toString()
        evaluateWebCallback("window.onExpertNetworkModeResult && window.onExpertNetworkModeResult($payload);")
    }

    private fun reportNetworkInfo(
        label: String,
        hasRadio: Boolean = packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_RADIO_ACCESS),
        supports5g: Boolean = false,
        message: String = ""
    ) {
        val payload = JSONObject()
            .put("label", label)
            .put("hasRadio", hasRadio)
            .put("supports5g", supports5g)
            .put("message", message)
            .toString()
        evaluateWebCallback("window.onExpertNetworkInfoResult && window.onExpertNetworkInfoResult($payload);")
    }

    private fun evaluateWebCallback(script: String) {
        if (!::webView.isInitialized) return
        webView.post { webView.evaluateJavascript(script, null) }
    }

    private fun openAndroidNetworkSettings() {
        val intents = listOf(
            Intent(Settings.ACTION_NETWORK_OPERATOR_SETTINGS),
            Intent(Settings.ACTION_WIRELESS_SETTINGS),
            Intent(Settings.ACTION_SETTINGS)
        )
        val target = intents.firstOrNull { it.resolveActivity(packageManager) != null }
        if (target != null) startActivity(target)
        else Toast.makeText(this, "Open Android Settings to manage mobile network mode.", Toast.LENGTH_LONG).show()
    }

    private fun openAndroidSimSettings() {
        val intents = listOf(
            Intent(Settings.ACTION_WIRELESS_SETTINGS),
            Intent(Settings.ACTION_SETTINGS)
        )
        val target = intents.firstOrNull { it.resolveActivity(packageManager) != null }
        if (target != null) startActivity(target)
        else Toast.makeText(this, "Open Android Settings to manage SIM cards.", Toast.LENGTH_LONG).show()
    }

    companion object {
        private const val REQUEST_PHONE_STATE = 401
    }
}
