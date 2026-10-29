package com.vayun.app

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

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
        settings.allowContentAccess = false
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setGeolocationEnabled(false)

        // Rendering & Caching for offline-first reliability
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW // Disallow insecure HTTP mixed content

        // Safe Browsing check
        if (WebViewFeature.isFeatureSupported(WebViewFeature.START_SAFE_BROWSING)) {
            WebViewCompat.startSafeBrowsing(this) { success ->
                // Safe Browsing initialized
            }
        }

        // 3. Register Native Javascript Interface Bridge
        webView.addJavascriptInterface(WebAppInterface(this), "VayunAndroid")

        // 4. Client Navigation Policy
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                // Allow internal asset navigation
                if (url.startsWith("file:///android_asset/")) {
                    return false
                }
                // Allow trusted Firebase and Google OAuth domains
                if (url.contains("accounts.google.com") || url.contains("firebaseapp.com")) {
                    return false
                }
                // Disallow arbitrary external URL navigation within webview (opens external browser instead)
                return true
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
            }
        }

        // 5. Android System Back Button Dispatcher
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

        // 6. Load Vayun Offline Screen Bundle
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

