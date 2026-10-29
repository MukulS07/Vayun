package com.vayun.app

import android.annotation.SuppressLint
import android.app.Dialog
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null

    // Native file picker launcher for WebView <input type="file">
    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK && result.data != null) {
            val clipData = result.data?.clipData
            val singleUri = result.data?.data
            if (clipData != null) {
                val uris = Array(clipData.itemCount) { i -> clipData.getItemAt(i).uri }
                fileUploadCallback?.onReceiveValue(uris)
            } else if (singleUri != null) {
                fileUploadCallback?.onReceiveValue(arrayOf(singleUri))
            } else {
                fileUploadCallback?.onReceiveValue(null)
            }
        } else {
            fileUploadCallback?.onReceiveValue(null)
        }
        fileUploadCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 1. Initialize WebView
        webView = WebView(this)
        setContentView(webView)

        // 2. Security Hardening for WebView
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true // Required for local-first IndexedDB / LocalStorage
        settings.databaseEnabled = true

        // Strict security locks
        settings.allowFileAccess = true // Allowed for bundled assets (file:///android_asset/)
        settings.allowContentAccess = true // Allowed for reading chosen files via file picker
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false
        settings.setGeolocationEnabled(false)

        // OAuth & Multi-Window Support for Google Sign-In & Firebase Auth
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.setSupportMultipleWindows(true)

        // Modern Mobile Chrome User Agent (removes embedded "; wv" flag to ensure Google OAuth passes)
        val defaultUserAgent = settings.userAgentString
        settings.userAgentString = defaultUserAgent.replace("; wv", "").replace("Version/4.0 ", "")

        // Rendering & Caching for offline-first reliability
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW // Disallow insecure HTTP mixed content

        // Safe Browsing check
        if (WebViewFeature.isFeatureSupported(WebViewFeature.START_SAFE_BROWSING)) {
            WebViewCompat.startSafeBrowsing(this) { _ ->
                // Safe Browsing initialized
            }
        }

        // 3. Register Native Javascript Interface Bridge
        webView.addJavascriptInterface(WebAppInterface(this), "VayunAndroid")

        // 4. WebChromeClient for File Chooser & OAuth Popups
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback

                val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
                try {
                    filePickerLauncher.launch(intent)
                } catch (_: Exception) {
                    fileUploadCallback?.onReceiveValue(null)
                    fileUploadCallback = null
                    return false
                }
                return true
            }

            override fun onCreateWindow(
                view: WebView?,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: Message?
            ): Boolean {
                val authWebView = WebView(this@MainActivity)
                val authSettings = authWebView.settings
                authSettings.javaScriptEnabled = true
                authSettings.domStorageEnabled = true
                authSettings.userAgentString = settings.userAgentString

                val authDialog = Dialog(this@MainActivity, android.R.style.Theme_DeviceDefault_NoActionBar_Fullscreen)
                authDialog.setContentView(authWebView)
                authDialog.show()

                authWebView.webChromeClient = object : WebChromeClient() {
                    override fun onCloseWindow(window: WebView?) {
                        authDialog.dismiss()
                        window?.destroy()
                    }
                }

                authWebView.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                        return false
                    }
                }

                val transport = resultMsg?.obj as? WebView.WebViewTransport
                transport?.webView = authWebView
                resultMsg?.sendToTarget()
                return true
            }
        }

        // 5. Client Navigation Policy
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                // Allow internal asset navigation
                if (url.startsWith("file:///android_asset/")) {
                    return false
                }
                // Allow trusted Firebase and Google OAuth domains
                if (url.contains("accounts.google.com") || url.contains("firebaseapp.com") || url.contains("googleapis.com")) {
                    return false
                }
                // Disallow arbitrary external URL navigation within webview (opens external browser instead)
                return true
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
            }
        }

        // 6. Android System Back Button Dispatcher
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Query WebView JavaScript to see if app drawer / modal was handled
                webView.evaluateJavascript("window.handleAndroidBackPressed ? window.handleAndroidBackPressed() : false") { result ->
                    val handled = result == "true"
                    if (!handled) {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            // Exit activity if no back stack remains
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                        }
                    }
                }
            }
        })

        // 7. Load Vayun Offline Screen Bundle
        webView.loadUrl("file:///android_asset/www/start.html")
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
