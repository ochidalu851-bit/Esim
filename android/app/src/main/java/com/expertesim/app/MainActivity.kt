package com.expertesim.app

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.telephony.euicc.DownloadableSubscription
import android.telephony.euicc.EuiccManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import org.json.JSONObject

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var operation = "connect"
    private var pendingPhoneAction = "connect"
    private var callbackRegistered = false
    private var pendingCallback: PendingIntent? = null
    private var pendingActivationCode = ""
    private var pendingConfirmationCode = ""
    private var preDownloadEmbeddedIds: Set<Int> = emptySet()
    private val esimPrefs by lazy { getSharedPreferences("expert_esim", MODE_PRIVATE) }

    private val callbackAction: String
        get() = "$packageName.action.ESIM_OPERATION"

    private val euiccReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent != null) handleEuiccResult(intent, resultCode)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(8, 10, 13)
        window.navigationBarColor = Color.rgb(8, 10, 13)

        webView = WebView(this)
        webView.setBackgroundColor(Color.rgb(8, 10, 13))
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
        webView.addJavascriptInterface(ExpertEsimBridge(), "ExpertESimNative")
        setContentView(webView)
        registerEuiccReceiver()
        webView.loadUrl("https://expert-esim-web-production.up.railway.app")
    }

    override fun onDestroy() {
        if (callbackRegistered) {
            runCatching { unregisterReceiver(euiccReceiver) }
            callbackRegistered = false
        }
        webView.removeJavascriptInterface("ExpertESimNative")
        webView.destroy()
        super.onDestroy()
    }

    private inner class ExpertEsimBridge {
        @JavascriptInterface
        fun connect() {
            runOnUiThread {
                operation = "connect"
                pendingPhoneAction = "connect"
                beginUserControlledOperation()
            }
        }

        @JavascriptInterface
        fun disconnect() {
            runOnUiThread {
                operation = "disconnect"
                pendingPhoneAction = "connect"
                beginUserControlledOperation()
            }
        }

        @JavascriptInterface
        fun downloadProfile(activationCode: String, confirmationCode: String) {
            runOnUiThread {
                operation = "download"
                if (activationCode.isBlank()) {
                    reportFailure("A carrier-issued eSIM activation code is required.")
                } else {
                    beginProfileDownload(activationCode.trim(), confirmationCode.trim())
                }
            }
        }

        @JavascriptInterface
        fun setPreferredNetwork(mode: String) {
            runOnUiThread { applyPreferredNetwork(mode.lowercase()) }
        }

        @JavascriptInterface
        fun getPreferredNetwork(): String {
            return JSONObject().put("mode", preferredNetworkMode()).toString()
        }

        @JavascriptInterface
        fun getCurrentNetworkInfo() {
            runOnUiThread {
                pendingPhoneAction = "networkInfo"
                if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(arrayOf(Manifest.permission.READ_PHONE_STATE), REQUEST_PHONE_STATE)
                } else {
                    sendCurrentNetworkInfo()
                }
            }
        }

        @JavascriptInterface
        fun openNetworkSettings() {
            runOnUiThread { openAndroidNetworkSettings() }
        }

        @JavascriptInterface
        fun getCapabilities(): String {
            val hasEuicc = packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_EUICC)
            val enabled = runCatching {
                getSystemService(EuiccManager::class.java)?.isEnabled == true
            }.getOrDefault(false)
            return JSONObject()
                .put("nativeAndroid", true)
                .put("hasEuiccHardware", hasEuicc)
                .put("euiccEnabled", enabled)
                .put("model", Build.MODEL ?: "unknown")
                .put("carrierProfileRequired", true)
                .toString()
        }

        @JavascriptInterface
        fun openSimSettings() {
            runOnUiThread { openAndroidSimSettings() }
        }
    }

    private fun beginUserControlledOperation() {
        if (!packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_EUICC)) {
            reportFailure("This phone does not expose eSIM hardware (eUICC).")
            return
        }

        val manager = getSystemService(EuiccManager::class.java)
        if (manager == null || !manager.isEnabled) {
            reportFailure("Android eSIM support is unavailable or disabled on this phone.")
            return
        }

        if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            pendingPhoneAction = "connect"
            requestPermissions(arrayOf(Manifest.permission.READ_PHONE_STATE), REQUEST_PHONE_STATE)
            return
        }
        performProfileSwitch(manager)
    }

    private fun beginProfileDownload(activationCode: String, confirmationCode: String) {
        if (!packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_EUICC)) {
            reportFailure("This phone does not expose eSIM hardware (eUICC), so it cannot download an eSIM profile.")
            return
        }
        val manager = getSystemService(EuiccManager::class.java)
        if (manager == null || !manager.isEnabled) {
            reportFailure("Android eSIM support is unavailable or disabled on this phone.")
            return
        }
        if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            pendingActivationCode = activationCode
            pendingConfirmationCode = confirmationCode
            pendingPhoneAction = "download"
            requestPermissions(arrayOf(Manifest.permission.READ_PHONE_STATE), REQUEST_PHONE_STATE)
            return
        }

        try {
            preDownloadEmbeddedIds = readSubscriptions().filter { it.isEmbedded }.map { it.subscriptionId }.toSet()
            pendingActivationCode = activationCode
            pendingConfirmationCode = confirmationCode
            val downloadable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && confirmationCode.isNotBlank()) {
                DownloadableSubscription.Builder(activationCode)
                    .setConfirmationCode(confirmationCode)
                    .build()
            } else {
                DownloadableSubscription.forActivationCode(activationCode)
            }
            val callback = createEuiccCallback()
            manager.downloadSubscription(downloadable, true, callback)
        } catch (security: SecurityException) {
            reportFailure("Android or the eSIM carrier denied profile installation. Follow the Android system approval prompt or ask the provider to authorise this device.")
        } catch (error: Exception) {
            reportFailure(error.message ?: "Android could not start the eSIM profile download.")
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_PHONE_STATE) return
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            when (pendingPhoneAction) {
                "networkInfo" -> reportNetworkInfo("Phone-state permission was not granted; current radio technology cannot be read.")
                "download" -> reportFailure("Phone-state permission was not granted, so the newly downloaded eSIM profile cannot be matched safely to Expert eSIM.")
                else -> reportFailure("Phone permission was not granted, so Expert eSIM cannot inspect the installed profile.")
            }
            pendingPhoneAction = "connect"
            return
        }

        when (pendingPhoneAction) {
            "networkInfo" -> {
                sendCurrentNetworkInfo()
                return
            }
            "download" -> {
                pendingPhoneAction = "connect"
                beginProfileDownload(pendingActivationCode, pendingConfirmationCode)
                return
            }
        }

        val manager = getSystemService(EuiccManager::class.java)
        if (manager == null || !manager.isEnabled) {
            reportFailure("Android eSIM support is not enabled.")
        } else {
            performProfileSwitch(manager)
        }
    }

    private fun readSubscriptions(): List<SubscriptionInfo> {
        val subscriptionManager = getSystemService(SubscriptionManager::class.java) ?: return emptyList()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            subscriptionManager.getAllSubscriptionInfoList()
        } else {
            subscriptionManager.activeSubscriptionInfoList.orEmpty()
        }
    }

    private fun findExpertProfile(): SubscriptionInfo? {
        val available = runCatching { readSubscriptions() }.getOrNull().orEmpty()
        val savedId = esimPrefs.getInt("profile_subscription_id", SubscriptionManager.INVALID_SUBSCRIPTION_ID)
        val savedProfile = available.firstOrNull { it.isEmbedded && it.subscriptionId == savedId }
        if (savedProfile != null) return savedProfile
        return available.firstOrNull { info ->
            val name = info.displayName?.toString().orEmpty()
            val carrier = info.carrierName?.toString().orEmpty()
            info.isEmbedded && (
                name.contains("Expert eSIM", ignoreCase = true) ||
                    carrier.contains("Expert eSIM", ignoreCase = true)
                )
        }
    }

    private fun captureNewExpertProfile(): SubscriptionInfo? {
        val available = runCatching { readSubscriptions() }.getOrNull().orEmpty()
        val newProfiles = available.filter { it.isEmbedded && it.subscriptionId !in preDownloadEmbeddedIds }
        val defaultDataId = SubscriptionManager.getDefaultDataSubscriptionId()
        val selected = newProfiles.firstOrNull { it.subscriptionId == defaultDataId }
            ?: newProfiles.singleOrNull()
        if (selected != null) {
            esimPrefs.edit()
                .putInt("profile_subscription_id", selected.subscriptionId)
                .putString("profile_carrier", selected.carrierName?.toString().orEmpty())
                .apply()
        }
        return selected
    }

    private fun preferredNetworkMode(): String {
        return esimPrefs.getString("preferred_network", "auto") ?: "auto"
    }

    private fun createEuiccCallback(): PendingIntent {
        val callbackIntent = Intent(callbackAction).setPackage(packageName)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        return PendingIntent.getBroadcast(this, REQUEST_EUICC_CALLBACK, callbackIntent, flags).also {
            pendingCallback = it
        }
    }

    private fun performProfileSwitch(manager: EuiccManager) {
        val profile = try {
            findExpertProfile()
        } catch (security: SecurityException) {
            reportFailure("Android or the carrier denied access to eSIM profile information.")
            return
        }

        if (profile == null) {
            reportFailure(
                "No Expert eSIM carrier profile is installed. Open Activate eSIM and enter the activation code issued by your mobile-network provider."
            )
            return
        }
        esimPrefs.edit().putInt("profile_subscription_id", profile.subscriptionId).apply()

        val callback = createEuiccCallback()
        try {
            if (operation == "connect") {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    manager.switchToSubscription(profile.subscriptionId, profile.portIndex, callback)
                } else {
                    manager.switchToSubscription(profile.subscriptionId, callback)
                }
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    manager.switchToSubscription(SubscriptionManager.INVALID_SUBSCRIPTION_ID, profile.portIndex, callback)
                } else {
                    manager.switchToSubscription(SubscriptionManager.INVALID_SUBSCRIPTION_ID, callback)
                }
            }
        } catch (security: SecurityException) {
            reportFailure("The eSIM provider has not authorised this app to manage that profile. Carrier privileges or Android system approval are required.")
        } catch (unsupported: UnsupportedOperationException) {
            reportFailure("This phone's Android version does not support the required eSIM operation.")
        } catch (error: Exception) {
            reportFailure(error.message ?: "Android could not start the eSIM operation.")
        }
    }

    private fun applyPreferredNetwork(mode: String) {
        if (mode !in listOf("auto", "4g", "5g")) {
            reportNetworkMode(false, mode, "Unknown network selection.")
            return
        }
        val model = (Build.MODEL ?: "").uppercase()
        if (mode == "5g" && (model.contains("CPH2127") || model.contains("A53"))) {
            reportNetworkMode(false, mode, "This OPPO A53 (CPH2127) has 4G LTE radio hardware, not 5G. A 5G handset is required.")
            return
        }
        esimPrefs.edit().putString("preferred_network", mode).apply()
        val profile = findExpertProfile()
        if (profile == null) {
            reportNetworkMode(true, mode, "Saved for Expert eSIM. This preference will be applied to the Expert eSIM subscription after your provider-issued profile is installed and activated.", pending = true)
            return
        }
        applyPreferredNetworkToSubscription(profile.subscriptionId, mode, reportResult = true)
    }

    private fun applyPreferredNetworkToSubscription(subId: Int, mode: String, reportResult: Boolean): Boolean {
        if (mode !in listOf("auto", "4g", "5g")) return false
        val model = (Build.MODEL ?: "").uppercase()
        if (mode == "5g" && (model.contains("CPH2127") || model.contains("A53"))) {
            if (reportResult) reportNetworkMode(false, mode, "This OPPO A53 (CPH2127) has 4G LTE radio hardware, not 5G. A 5G handset is required.")
            return false
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            openAndroidNetworkSettings()
            if (reportResult) reportNetworkMode(false, mode, "Android 13 or newer is required for this app to request the selected radio mode. Android network settings were opened; choose the Expert eSIM line there.")
            return false
        }
        try {
            val baseManager = getSystemService(TelephonyManager::class.java)
                ?: throw IllegalStateException("Android telephony service is unavailable.")
            // Bind the radio preference to the Expert eSIM subscription, never the default physical SIM.
            val manager = baseManager.createForSubscriptionId(subId)
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
            if (reportResult) {
                val message = when (mode) {
                    "4g" -> "Android accepted 4G LTE-only mode for the Expert eSIM subscription."
                    "5g" -> "Android accepted 5G NR with LTE fallback for the Expert eSIM subscription. Actual 5G still depends on the provider's plan, coverage and device radio."
                    else -> "Android reset the Expert eSIM subscription to automatic radio selection."
                }
                reportNetworkMode(true, mode, message)
            }
            return true
        } catch (security: SecurityException) {
            openAndroidNetworkSettings()
            if (reportResult) reportNetworkMode(false, mode, "Android/carrier privileges are required to set the radio mode directly for this eSIM. Android network settings were opened; select the Expert eSIM line manually.")
        } catch (unsupported: UnsupportedOperationException) {
            openAndroidNetworkSettings()
            if (reportResult) reportNetworkMode(false, mode, "This handset or carrier does not expose direct network-mode control for the Expert eSIM. Android network settings were opened.")
        } catch (error: Exception) {
            if (reportResult) reportNetworkMode(false, mode, error.message ?: "Android could not apply the requested network mode to Expert eSIM.")
        }
        return false
    }

    private fun sendCurrentNetworkInfo() {
        try {
            val baseManager = getSystemService(TelephonyManager::class.java)
            if (baseManager == null) {
                reportNetworkInfo("Android telephony service is unavailable.")
                return
            }
            val expertProfile = findExpertProfile()
            val subId = expertProfile?.subscriptionId ?: SubscriptionManager.getDefaultDataSubscriptionId()
            val manager = if (subId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
                baseManager.createForSubscriptionId(subId)
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
            val model = (Build.MODEL ?: "").uppercase()
            val supports5gKnownNo = model.contains("CPH2127") || model.contains("A53")
            reportNetworkInfo(
                label,
                hasRadio = packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_RADIO_ACCESS),
                supports5g = type == TelephonyManager.NETWORK_TYPE_NR,
                message = if (supports5gKnownNo) {
                    "Device detected: OPPO A53 (CPH2127). This phone supports 4G LTE, not 5G."
                } else {
                    if (expertProfile != null) "Network type is read from the saved Expert eSIM subscription." else "No Expert eSIM profile was found; showing the current default data SIM."
                }
            )
        } catch (security: SecurityException) {
            reportNetworkInfo("Permission required", message = "Android denied access to current mobile network information.")
        } catch (error: Exception) {
            reportNetworkInfo("Network type unavailable", message = error.message ?: "Could not read the active mobile network.")
        }
    }

    private fun registerEuiccReceiver() {
        val filter = IntentFilter(callbackAction)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(euiccReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(euiccReceiver, filter)
        }
        callbackRegistered = true
    }

    private fun handleEuiccResult(resultIntent: Intent, result: Int) {
        when (result) {
            EuiccManager.EMBEDDED_SUBSCRIPTION_RESULT_OK -> {
                when (operation) {
                    "connect" -> {
                        val profile = findExpertProfile()
                        val networkApplied = profile != null && applyPreferredNetworkToSubscription(profile.subscriptionId, preferredNetworkMode(), reportResult = true)
                        val networkMessage = if (networkApplied) " The saved ${preferredNetworkMode().uppercase()} preference was applied to this eSIM subscription." else " The saved ${preferredNetworkMode().uppercase()} preference could not be enforced directly; Android or the carrier may require manual network settings."
                        reportSuccess(true, "Android enabled the Expert eSIM carrier profile. Select this line as the phone's Mobile data SIM in Android SIM settings to use its data plan.$networkMessage")
                    }
                    "download" -> {
                        val profile = captureNewExpertProfile()
                        if (profile == null) {
                            reportSuccess(false, "Android reports that the profile download completed, but this app could not identify the new eSIM subscription safely. Check Android SIM settings before connecting.")
                        } else {
                            val networkApplied = applyPreferredNetworkToSubscription(profile.subscriptionId, preferredNetworkMode(), reportResult = true)
                            val networkMessage = if (networkApplied) " The saved ${preferredNetworkMode().uppercase()} preference was applied to that eSIM line." else " The ${preferredNetworkMode().uppercase()} preference is saved but Android/carrier privileges may be needed to enforce it."
                            reportSuccess(true, "The provider-issued eSIM profile was downloaded and enabled. Select Expert eSIM as the phone's Mobile data SIM in Android SIM settings if it is not already selected.${networkMessage}")
                        }
                    }
                    else -> reportSuccess(false, "Expert eSIM profile disabled. Check Android SIM settings to confirm which physical SIM is now active for mobile data.")
                }
            }
            EuiccManager.EMBEDDED_SUBSCRIPTION_RESULT_RESOLVABLE_ERROR -> {
                val manager = getSystemService(EuiccManager::class.java)
                val callback = pendingCallback
                if (manager == null || callback == null) {
                    reportFailure("Android requires confirmation but the approval flow could not be opened.")
                    return
                }
                try {
                    manager.startResolutionActivity(this, REQUEST_EUICC_RESOLUTION, resultIntent, callback)
                } catch (error: Exception) {
                    reportFailure(error.message ?: "Android could not open the eSIM approval screen.")
                }
            }
            else -> {
                val detailed = resultIntent.getIntExtra(EuiccManager.EXTRA_EMBEDDED_SUBSCRIPTION_DETAILED_CODE, 0)
                reportFailure("Android did not complete the eSIM operation (code $result, detail $detailed).")
            }
        }
    }

    private fun reportSuccess(connected: Boolean, message: String) {
        val payload = JSONObject()
            .put("ok", true)
            .put("connected", connected)
            .put("operation", operation)
            .put("message", message)
            .toString()
        evaluateWebCallback("window.onExpertEsimNativeResult && window.onExpertEsimNativeResult($payload);")
    }

    private fun reportFailure(message: String) {
        val payload = JSONObject()
            .put("ok", false)
            .put("connected", false)
            .put("operation", operation)
            .put("message", message)
            .toString()
        evaluateWebCallback("window.onExpertEsimNativeResult && window.onExpertEsimNativeResult($payload);")
    }

    private fun reportNetworkMode(applied: Boolean, mode: String, message: String, pending: Boolean = false) {
        val payload = JSONObject()
            .put("ok", applied || pending)
            .put("applied", applied)
            .put("pending", pending)
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
        if (target != null) {
            startActivity(target)
        } else {
            Toast.makeText(this, "Open Android Settings to manage mobile network mode.", Toast.LENGTH_LONG).show()
        }
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
        private const val REQUEST_EUICC_CALLBACK = 402
        private const val REQUEST_EUICC_RESOLUTION = 403
    }
}
