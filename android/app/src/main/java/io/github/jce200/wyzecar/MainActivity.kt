package io.github.jce200.wyzecar

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.hardware.input.InputManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.HttpAuthHandler
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.max
import kotlin.math.min

/**
 * Full-screen shell around the controller page that the camera hosts at
 * /car/. All drive and safety logic stays in that page and on the camera;
 * this activity adds the address setup, sign-in, error screens and gamepad
 * input, and makes sure the page is paused whenever the app is not in front.
 */
class MainActivity : Activity(), InputManager.InputDeviceListener {

    private lateinit var root: View
    private lateinit var web: WebView
    private lateinit var progress: View
    private lateinit var setupPanel: View
    private lateinit var errorPanel: View
    private lateinit var openController: Button
    private lateinit var addressField: EditText
    private lateinit var addressError: View
    private lateinit var errorMessage: TextView

    private var origin: String? = null
    private var pageFailed = false
    private var webDestroyed = false

    private var gamepad = GamepadState()
    private var sentInput = DriveInput.NEUTRAL

    private val authHandlers = mutableListOf<HttpAuthHandler>()
    private var authDialog: AlertDialog? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)

        root = findViewById(R.id.root)
        web = findViewById(R.id.web)
        progress = findViewById(R.id.progress)
        setupPanel = findViewById(R.id.setup_panel)
        errorPanel = findViewById(R.id.error_panel)
        openController = findViewById(R.id.open_controller)
        addressField = findViewById(R.id.address)
        addressError = findViewById(R.id.address_error)
        errorMessage = findViewById(R.id.error_message)

        configureWindow()
        configureWebView()

        findViewById<View>(R.id.connect).setOnClickListener { submitAddress() }
        addressField.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) { submitAddress(); true } else false
        }
        findViewById<View>(R.id.retry).setOnClickListener { loadController() }
        findViewById<View>(R.id.change_address).setOnClickListener { showSetup() }
        openController.setOnClickListener { loadController() }

        (getSystemService(Context.INPUT_SERVICE) as InputManager).registerInputDeviceListener(this, null)

        origin = getPreferences(MODE_PRIVATE).getString(KEY_ORIGIN, null)?.let(CameraAddress::normalize)
        if (origin == null) showSetup() else loadController()
    }

    // ---- Window ---------------------------------------------------------

    private fun configureWindow() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Draw edge to edge and keep the content clear of the display
            // cutout, any visible system bars and the on-screen keyboard.
            window.setDecorFitsSystemWindows(false)
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
            root.setOnApplyWindowInsetsListener { view, insets ->
                val safe = insets.getInsets(
                    WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime()
                )
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
                insets
            }
        }
        // Keep the forms readable on wide screens.
        val forms = listOf<View>(findViewById(R.id.setup_form), findViewById(R.id.error_form))
        root.addOnLayoutChangeListener { _, left, _, right, _, _, _, _, _ ->
            val density = resources.displayMetrics.density
            val available = right - left - root.paddingLeft - root.paddingRight - (48 * density).toInt()
            val width = max(0, min((440 * density).toInt(), available))
            for (form in forms) {
                if (form.layoutParams.width != width) {
                    form.layoutParams = form.layoutParams.apply { this.width = width }
                }
            }
        }
    }

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                it.hide(WindowInsets.Type.systemBars())
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    // ---- Screens --------------------------------------------------------

    private fun showSetup() {
        releaseGamepad()
        addressField.setText(origin?.removePrefix("http://") ?: "")
        addressField.setSelection(addressField.text.length)
        addressError.visibility = View.GONE
        errorPanel.visibility = View.GONE
        progress.visibility = View.GONE
        openController.visibility = View.GONE
        // Leaving the controller page makes it stop the Car, like closing a tab.
        web.visibility = View.INVISIBLE
        web.stopLoading()
        web.loadUrl("about:blank")
        setupPanel.visibility = View.VISIBLE
    }

    private fun submitAddress() {
        val normalized = CameraAddress.normalize(addressField.text.toString())
        if (normalized == null) {
            addressError.visibility = View.VISIBLE
            return
        }
        origin = normalized
        getPreferences(MODE_PRIVATE).edit().putString(KEY_ORIGIN, normalized).apply()
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(addressField.windowToken, 0)
        addressField.clearFocus()
        loadController()
    }

    private fun loadController() {
        val target = origin ?: return showSetup()
        releaseGamepad()
        pageFailed = false
        setupPanel.visibility = View.GONE
        errorPanel.visibility = View.GONE
        openController.visibility = View.GONE
        web.visibility = View.INVISIBLE
        progress.visibility = View.VISIBLE
        web.loadUrl(CameraAddress.controllerUrl(target))
    }

    private fun showError(message: String) {
        pageFailed = true
        releaseGamepad()
        errorMessage.text = message
        progress.visibility = View.GONE
        openController.visibility = View.GONE
        web.visibility = View.INVISIBLE
        setupPanel.visibility = View.GONE
        errorPanel.visibility = View.VISIBLE
    }

    private fun showMenu() {
        val labels = arrayOf(
            getString(R.string.menu_reload),
            getString(R.string.menu_change),
            getString(R.string.menu_thingino),
            getString(R.string.menu_exit),
        )
        AlertDialog.Builder(this)
            .setTitle(R.string.app_name)
            .setItems(labels) { _, which ->
                when (which) {
                    0 -> loadController()
                    1 -> showSetup()
                    2 -> origin?.let { web.loadUrl("$it/") }
                    3 -> finish()
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val target = origin
        when {
            setupPanel.visibility == View.VISIBLE -> if (target != null) loadController() else finish()
            errorPanel.visibility == View.VISIBLE -> showMenu()
            target != null && !CameraAddress.isControllerUrl(web.url, target) && web.canGoBack() -> web.goBack()
            else -> showMenu()
        }
    }

    // ---- WebView --------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled") // The page is the camera's own controller.
    private fun configureWebView() {
        web.setBackgroundColor(Color.BLACK)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            setSupportMultipleWindows(false)
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val target = origin
                val url = request.url.toString()
                if (target != null && CameraAddress.isSameCamera(url, target)) return false
                // Only the camera is shown inside the app.
                if (request.url.scheme == "http" || request.url.scheme == "https") {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    } catch (_: ActivityNotFoundException) {
                    }
                }
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                // A new page has no keys held; forget what the old one was sent.
                sentInput = DriveInput.NEUTRAL
            }

            // The MJPEG stream keeps the page "loading", so onPageFinished may
            // never arrive. The first committed frame is the reliable signal.
            override fun onPageCommitVisible(view: WebView, url: String?) = pageShown(url)

            override fun onPageFinished(view: WebView, url: String?) = pageShown(url)

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame && request.url.toString() != "about:blank") {
                    showError(getString(R.string.error_generic, displayAddress(), error.description))
                }
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                val target = origin ?: return
                if (request.isForMainFrame && response.statusCode == 404 &&
                    CameraAddress.isControllerUrl(request.url.toString(), target)
                ) {
                    showError(getString(R.string.error_not_installed, displayAddress()))
                }
            }

            override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String?, realm: String?) {
                askForCredentials(handler)
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // The page is gone, so the camera watchdog has stopped the Car.
                destroyWebView()
                recreate()
                return true
            }
        }
    }

    private fun displayAddress(): String = origin?.substringAfter("://") ?: ""

    private fun pageShown(url: String?) {
        val target = origin
        if (pageFailed || target == null || setupPanel.visibility == View.VISIBLE) return
        if (url == null || url == "about:blank") return
        progress.visibility = View.GONE
        web.visibility = View.VISIBLE
        // Thingino's own pages (for example its sign-in) have no link back.
        openController.visibility =
            if (CameraAddress.isControllerUrl(url, target)) View.GONE else View.VISIBLE
    }

    private fun askForCredentials(handler: HttpAuthHandler) {
        authHandlers += handler
        if (authDialog != null) return

        val density = resources.displayMetrics.density
        val user = EditText(this).apply {
            hint = getString(R.string.auth_user)
            setText(DEFAULT_USER)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            isSingleLine = true
        }
        val password = EditText(this).apply {
            hint = getString(R.string.auth_password)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            isSingleLine = true
        }
        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (20 * density).toInt()
            setPadding(pad, pad / 2, pad, 0)
            addView(user)
            addView(password)
        }
        fun finish(action: (HttpAuthHandler) -> Unit) {
            val pending = authHandlers.toList()
            authHandlers.clear()
            authDialog = null
            pending.forEach(action)
        }
        authDialog = AlertDialog.Builder(this)
            .setTitle(R.string.auth_title)
            .setMessage(displayAddress())
            .setView(form)
            .setPositiveButton(R.string.auth_sign_in) { _, _ ->
                val name = user.text.toString()
                val secret = password.text.toString()
                finish { it.proceed(name, secret) }
            }
            .setNegativeButton(R.string.cancel) { _, _ -> finish { it.cancel() } }
            .setOnCancelListener { finish { it.cancel() } }
            .show()
        password.requestFocus()
    }

    private fun destroyWebView() {
        if (webDestroyed) return
        webDestroyed = true
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
    }

    // ---- Lifecycle ------------------------------------------------------

    override fun onResume() {
        super.onResume()
        if (!webDestroyed) web.onResume()
        hideSystemBars()
    }

    override fun onPause() {
        // The page pauses control when it becomes hidden; the camera's own
        // 450 ms watchdog stops the motors even if that request is lost.
        releaseGamepad()
        if (!webDestroyed) web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        (getSystemService(Context.INPUT_SERVICE) as InputManager).unregisterInputDeviceListener(this)
        authDialog?.dismiss()
        destroyWebView()
        super.onDestroy()
    }

    // ---- Gamepad --------------------------------------------------------
    //
    // WebView does not reliably expose the Gamepad API on a plain-HTTP page,
    // so gamepad input is translated into the page's keyboard controls:
    // arrow keys to drive and Space for the emergency stop.

    private fun controllerActive(): Boolean {
        val target = origin ?: return false
        return !webDestroyed && !pageFailed && web.visibility == View.VISIBLE &&
            CameraAddress.isControllerUrl(web.url, target)
    }

    private fun sendKey(type: String, key: String, code: String) {
        if (webDestroyed) return
        web.evaluateJavascript(
            "document.dispatchEvent(new KeyboardEvent('$type',{key:'$key',code:'$code',bubbles:true,cancelable:true}));",
            null,
        )
    }

    private fun applyGamepad(state: GamepadState) {
        gamepad = state
        val input = if (controllerActive()) GamepadMapper.toDriveInput(state) else DriveInput.NEUTRAL
        for ((key, down) in GamepadMapper.keyTransitions(sentInput, input)) {
            sendKey(if (down) "keydown" else "keyup", key, key)
        }
        sentInput = input
    }

    private fun releaseGamepad() {
        gamepad = GamepadState()
        for ((key, _) in GamepadMapper.keyTransitions(sentInput, DriveInput.NEUTRAL)) {
            sendKey("keyup", key, key)
        }
        sentInput = DriveInput.NEUTRAL
    }

    private fun isFromGamepad(event: KeyEvent): Boolean {
        val pad = InputDevice.SOURCE_GAMEPAD
        val stick = InputDevice.SOURCE_JOYSTICK
        val device = event.device?.sources ?: 0
        return event.source and pad == pad || event.source and stick == stick || device and pad == pad
    }

    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        if (event.isFromSource(InputDevice.SOURCE_JOYSTICK) && event.actionMasked == MotionEvent.ACTION_MOVE &&
            controllerActive()
        ) {
            applyGamepad(
                gamepad.copy(
                    stickX = event.getAxisValue(MotionEvent.AXIS_X),
                    stickY = event.getAxisValue(MotionEvent.AXIS_Y),
                    hatX = event.getAxisValue(MotionEvent.AXIS_HAT_X),
                    hatY = event.getAxisValue(MotionEvent.AXIS_HAT_Y),
                    rightTrigger = max(
                        event.getAxisValue(MotionEvent.AXIS_RTRIGGER), event.getAxisValue(MotionEvent.AXIS_GAS)
                    ),
                    leftTrigger = max(
                        event.getAxisValue(MotionEvent.AXIS_LTRIGGER), event.getAxisValue(MotionEvent.AXIS_BRAKE)
                    ),
                )
            )
            return true
        }
        return super.dispatchGenericMotionEvent(event)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!isFromGamepad(event) || !controllerActive()) return super.dispatchKeyEvent(event)
        val down = event.action == KeyEvent.ACTION_DOWN
        when (event.keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT -> applyGamepad(gamepad.copy(dpadLeft = down))
            KeyEvent.KEYCODE_DPAD_RIGHT -> applyGamepad(gamepad.copy(dpadRight = down))
            KeyEvent.KEYCODE_DPAD_UP -> applyGamepad(gamepad.copy(dpadUp = down))
            KeyEvent.KEYCODE_DPAD_DOWN -> applyGamepad(gamepad.copy(dpadDown = down))
            KeyEvent.KEYCODE_BUTTON_B -> if (down && event.repeatCount == 0) sendKey("keydown", " ", "Space")
            else -> {
                // Other gamepad buttons must not "click" whatever is focused.
                if (!KeyEvent.isGamepadButton(event.keyCode)) return super.dispatchKeyEvent(event)
            }
        }
        return true
    }

    override fun onInputDeviceAdded(deviceId: Int) = Unit

    override fun onInputDeviceChanged(deviceId: Int) = Unit

    // A gamepad that disconnects mid-drive never sends its release events.
    override fun onInputDeviceRemoved(deviceId: Int) = releaseGamepad()

    private companion object {
        const val KEY_ORIGIN = "camera_origin"
        const val DEFAULT_USER = "root"
    }
}
