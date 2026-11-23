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
    private var callbackRegistered = false
    private var pendingCallback: PendingIntent? = null

    private val callbackAction: String
        get() = "$packageName.action.ESIM_OPERATION"

    private val euiccReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent == null) return
            handleEuiccResult(intent)
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
                beginUserControlledOperation()
            }
        }

        @JavascriptInterface
        fun disconnect() {
            runOnUiThread {
                operation = "disconnect"
                beginUserControlledOperation()
            }
        }

        @JavascriptInterface
        fun getCapabilities(): String {
            val hasEuicc = packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_EUICC)
            val enabled = runCatching { getSystemService(EuiccManager::class.java)?.isEnabled == true }.getOrDefault(false)
            return JSONObject()
                .put("nativeAndroid", true)
                .put("hasEuiccHardware", hasEuicc)
                .put("euiccEnabled", enabled)
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
            requestPermissions(arrayOf(Manifest.permission.READ_PHONE_STATE), REQUEST_PHONE_STATE)
            return
        }

        performProfileSwitch(manager)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_PHONE_STATE) return
        if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            val manager = getSystemService(EuiccManager::class.java)
            if (manager == null || !manager.isEnabled) {
                reportFailure("Android eSIM support is not enabled.")
            } else {
                performProfileSwitch(manager)
            }
        } else {
            reportFailure("Phone permission was not granted, so Expert eSIM cannot inspect the installed profile.")
        }
    }

    private fun findExpertProfile(): SubscriptionInfo? {
        val subscriptionManager = getSystemService(SubscriptionManager::class.java) ?: return null
        val available = runCatching { subscriptionManager.availableSubscriptionInfoList }.getOrNull().orEmpty()
        return available.firstOrNull { info ->
            val name = info.displayName?.toString().orEmpty()
            val carrier = info.carrierName?.toString().orEmpty()
            info.isEmbedded && (
                name.contains("Expert eSIM", ignoreCase = true) ||
                carrier.contains("Expert eSIM", ignoreCase = true)
            )
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
                "No installed eSIM profile labelled Expert eSIM was found. A mobile eSIM provider must issue and install your profile first."
            )
            return
        }

        val callbackIntent = Intent(callbackAction).setPackage(packageName)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        val callback = PendingIntent.getBroadcast(this, REQUEST_EUICC_CALLBACK, callbackIntent, flags)
        pendingCallback = callback

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
            reportFailure(
                "The eSIM provider has not authorised this app to manage that profile. Carrier privileges or Android system approval are required."
            )
        } catch (unsupported: UnsupportedOperationException) {
            reportFailure("This phone's Android version does not support the required eSIM operation.")
        } catch (error: Exception) {
            reportFailure(error.message ?: "Android could not start the eSIM operation.")
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

    private fun handleEuiccResult(resultIntent: Intent) {
        val result = resultIntent.getIntExtra(
            EuiccManager.EXTRA_EMBEDDED_SUBSCRIPTION_RESULT,
            EuiccManager.EMBEDDED_SUBSCRIPTION_RESULT_ERROR
        )
        when (result) {
            EuiccManager.EMBEDDED_SUBSCRIPTION_RESULT_OK -> {
                if (operation == "connect") {
                    reportSuccess(
                        true,
                        "Android enabled the Expert eSIM profile. Confirm Expert eSIM is selected for mobile data in your phone's SIM settings."
                    )
                } else {
                    reportSuccess(
                        false,
                        "Expert eSIM profile disabled. Android may restore the previously active SIM automatically; check SIM settings if mobile data does not return."
                    )
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
            .put("message", message)
            .toString()
        evaluateWebCallback(payload)
    }

    private fun reportFailure(message: String) {
        val payload = JSONObject()
            .put("ok", false)
            .put("connected", false)
            .put("message", message)
            .toString()
        evaluateWebCallback(payload)
    }

    private fun evaluateWebCallback(payload: String) {
        if (!::webView.isInitialized) return
        webView.post {
            webView.evaluateJavascript(
                "window.onExpertEsimNativeResult && window.onExpertEsimNativeResult($payload);",
                null
            )
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
