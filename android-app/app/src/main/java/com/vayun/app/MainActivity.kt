package com.vayun.app

import android.annotation.SuppressLint
import android.app.Dialog
import android.content.Intent
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.view.ViewGroup
import android.widget.FrameLayout
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null

    // Track active OAuth dialog to prevent window leaks on rotation/pause
    private var activeAuthDialog: Dialog? = null
    private var activeAuthWebView: WebView? = null

    // Native file picker launcher for WebView <input type="file">
    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        fileUploadCallback?.onReceiveValue(uris)
        fileUploadCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        // Material 3 Core Splash Screen API
        installSplashScreen()
        super.onCreate(savedInstanceState)

        // Native Edge-to-Edge window setup
        WindowCompat.setDecorFitsSystemWindows(window, false)

        // Dark by default so the strips behind the status/nav bars never flash white; the page
        // later retunes this through VayunAndroid.setStatusBarColor.
        window.setBackgroundDrawable(ColorDrawable(0xFF05070A.toInt()))
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        // 1. Initialize WebView & Asset Loader
        webView = WebView(this)
        val rootContainer = FrameLayout(this)
        rootContainer.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(rootContainer)

        // Apply Window Insets for camera notches and navigation pills
        // WebView doesn't report status/navigation bar insets as env(safe-area-inset-*), and it
        // ignores its own padding, so pad the container around it; otherwise the page draws under
        // the status bar and gesture/nav bar.
        ViewCompat.setOnApplyWindowInsetsListener(rootContainer) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        // 2. Security Hardening & Modern Settings
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true // Required for local-first IndexedDB / LocalStorage

        // Secure access locks: disable raw file access, content is loaded safely via WebViewAssetLoader
        settings.allowFileAccess = false
        settings.allowContentAccess = true // Allowed for chosen files via file picker
        settings.setGeolocationEnabled(false)

        // OAuth & Multi-Window Support for Google Sign-In & Firebase Auth
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.setSupportMultipleWindows(true)

        // Modern Mobile Chrome User Agent (removes embedded "; wv" to ensure Google OAuth passes)
        val defaultUserAgent = settings.userAgentString
        settings.userAgentString = defaultUserAgent.replace("; wv", "").replace("Version/4.0 ", "")

        // Offline-first caching & security
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

        // Safe Browsing initialization
        if (WebViewFeature.isFeatureSupported(WebViewFeature.START_SAFE_BROWSING)) {
            WebViewCompat.startSafeBrowsing(this) { _ -> }
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
                return try {
                    filePickerLauncher.launch(intent)
                    true
                } catch (_: Exception) {
                    fileUploadCallback?.onReceiveValue(null)
                    fileUploadCallback = null
                    false
                }
            }

            override fun onCreateWindow(
                view: WebView?,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: Message?
            ): Boolean {
                cleanupAuthDialog()

                val authWebView = WebView(this@MainActivity)
                activeAuthWebView = authWebView

                val authSettings = authWebView.settings
                authSettings.javaScriptEnabled = true
                authSettings.domStorageEnabled = true
                authSettings.userAgentString = settings.userAgentString

                val authDialog = Dialog(this@MainActivity, R.style.Theme_Vayun_AuthDialog).apply {
                    setContentView(authWebView)
                    setOnDismissListener {
                        cleanupAuthDialog()
                    }
                }
                activeAuthDialog = authDialog
                authDialog.show()

                authWebView.webChromeClient = object : WebChromeClient() {
                    override fun onCloseWindow(window: WebView?) {
                        cleanupAuthDialog()
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

        // 5. Client Navigation Policy & Asset Interception
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                // Internal assets over virtual HTTPS domain
                if (url.startsWith("https://appassets.androidplatform.net/")) {
                    return false
                }
                // Trusted Firebase and Google OAuth domains
                if (url.contains("accounts.google.com") || url.contains("firebaseapp.com") || url.contains("googleapis.com")) {
                    return false
                }
                // Open all external URLs safely in user's default browser
                try {
                    val browserIntent = Intent(Intent.ACTION_VIEW, request.url)
                    startActivity(browserIntent)
                } catch (_: Exception) {}
                return true
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    val failingUrl = request.url?.toString() ?: ""
                    if (failingUrl.startsWith("https://appassets.androidplatform.net/")) {
                        view?.postDelayed({ view.reload() }, 500)
                    }
                }
            }
        }

        // 6. System Back Button Dispatcher with safe re-enabling
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("window.handleAndroidBackPressed ? window.handleAndroidBackPressed() : false") { result ->
                    val handled = result == "true"
                    if (!handled) {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                            isEnabled = true
                        }
                    }
                }
            }
        })

        // 7. Safe Initial Load (Prevents double load on process restoration)
        if (savedInstanceState == null) {
            handleSafeIntent(intent)
        }
    }

    private fun handleSafeIntent(incomingIntent: Intent?) {
        val uri = incomingIntent?.data
        if (uri != null && ((uri.scheme.equals("https", ignoreCase = true)) &&
            (uri.host.equals("appassets.androidplatform.net", ignoreCase = true)))) {
            webView.loadUrl(uri.toString())
        } else {
            webView.loadUrl("https://appassets.androidplatform.net/assets/www/welcome.html")
        }
    }

    private fun cleanupAuthDialog() {
        try {
            activeAuthDialog?.dismiss()
        } catch (_: Exception) {}
        activeAuthDialog = null
        try {
            activeAuthWebView?.destroy()
        } catch (_: Exception) {}
        activeAuthWebView = null
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        cleanupAuthDialog()
        webView.onPause()
        super.onPause()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleSafeIntent(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        webView.restoreState(savedInstanceState)
    }

    override fun onDestroy() {
        cleanupAuthDialog()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }
}
