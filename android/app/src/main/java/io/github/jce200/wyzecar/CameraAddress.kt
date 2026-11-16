package io.github.jce200.wyzecar

/** Parsing and matching of the camera address typed by the user. */
object CameraAddress {
    private val HOST = Regex("^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$")
    private val IPV6 = Regex("^\\[[0-9a-f:.]{2,45}]$")

    /**
     * Turns user input such as "192.168.1.123", "cam.local:8080" or
     * "http://192.168.1.123/car/" into an origin like "http://192.168.1.123".
     * Returns null when the input is not a plain host with an optional port.
     */
    fun normalize(input: String): String? {
        var rest = input.trim().lowercase()
        var scheme = "http"
        when {
            rest.startsWith("http://") -> rest = rest.substring(7)
            rest.startsWith("https://") -> { scheme = "https"; rest = rest.substring(8) }
            rest.contains("://") -> return null
        }
        rest = rest.substringBefore('/').substringBefore('?').substringBefore('#')
        if (rest.isEmpty() || rest.contains('@') || rest.any { it.isWhitespace() }) return null

        val host: String
        var port: String? = null
        if (rest.startsWith("[")) {
            val end = rest.indexOf(']')
            if (end < 0) return null
            host = rest.substring(0, end + 1)
            val tail = rest.substring(end + 1)
            if (tail.isNotEmpty()) {
                if (!tail.startsWith(":")) return null
                port = tail.substring(1)
            }
            if (!IPV6.matches(host)) return null
        } else {
            val colon = rest.indexOf(':')
            if (colon >= 0) {
                host = rest.substring(0, colon)
                port = rest.substring(colon + 1)
            } else {
                host = rest
            }
            if (!HOST.matches(host) || host.contains("..")) return null
        }
        if (port != null) {
            if (port.isEmpty() || port.length > 5 || port.any { it !in '0'..'9' }) return null
            if (port.toInt() !in 1..65535) return null
        }
        return scheme + "://" + host + if (port != null) ":$port" else ""
    }

    fun controllerUrl(origin: String): String = "$origin/car/"

    /** True when [url] is a page of the camera at [origin]. */
    fun isSameCamera(url: String?, origin: String): Boolean {
        if (url == null) return false
        val lower = url.lowercase()
        if (lower == origin) return true
        return lower.startsWith("$origin/") || lower.startsWith("$origin?") || lower.startsWith("$origin#")
    }

    /** True when [url] is the Car controller page of the camera at [origin]. */
    fun isControllerUrl(url: String?, origin: String): Boolean {
        if (url == null) return false
        val path = url.substringBefore('#').substringBefore('?')
        return path.equals("$origin/car/", ignoreCase = true) ||
            path.equals("$origin/car/index.html", ignoreCase = true)
    }
}
