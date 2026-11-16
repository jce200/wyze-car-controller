package io.github.jce200.wyzecar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CameraAddressTest {
    @Test
    fun acceptsPlainAddresses() {
        assertEquals("http://192.168.1.123", CameraAddress.normalize(" 192.168.1.123 "))
        assertEquals("http://cam.local:8080", CameraAddress.normalize("Cam.Local:8080"))
        assertEquals("http://192.168.1.123", CameraAddress.normalize("http://192.168.1.123/car/"))
        assertEquals("https://cam.example", CameraAddress.normalize("https://cam.example/x?y#z"))
        assertEquals("http://[fe80::1]:81", CameraAddress.normalize("[FE80::1]:81"))
    }

    @Test
    fun rejectsUnsafeOrBrokenInput() {
        for (bad in listOf(
            "", "   ", "ftp://cam", "user:pw@192.168.1.2", "cam .local", "cam:", "cam:0",
            "cam:70000", "cam:8a", "-cam", "cam..local", "[fe80::1", "[fe80::1]x", "javascript:alert(1)",
        )) {
            assertNull(bad, CameraAddress.normalize(bad))
        }
    }

    @Test
    fun matchesOnlyTheConfiguredCamera() {
        val origin = "http://192.168.1.12"
        assertTrue(CameraAddress.isSameCamera("http://192.168.1.12/", origin))
        assertTrue(CameraAddress.isSameCamera("http://192.168.1.12/x/login.cgi?a=1", origin))
        assertFalse(CameraAddress.isSameCamera("http://192.168.1.123/", origin))
        assertFalse(CameraAddress.isSameCamera("http://192.168.1.12.evil.example/", origin))
        assertFalse(CameraAddress.isSameCamera("http://192.168.1.12:8080/", origin))
        assertFalse(CameraAddress.isSameCamera(null, origin))
    }

    @Test
    fun recognisesTheControllerPage() {
        val origin = "http://192.168.1.12"
        assertEquals("http://192.168.1.12/car/", CameraAddress.controllerUrl(origin))
        assertTrue(CameraAddress.isControllerUrl("http://192.168.1.12/car/", origin))
        assertTrue(CameraAddress.isControllerUrl("http://192.168.1.12/car/index.html?v=1#top", origin))
        assertFalse(CameraAddress.isControllerUrl("http://192.168.1.12/", origin))
        assertFalse(CameraAddress.isControllerUrl("http://192.168.1.12/car/other.html", origin))
        assertFalse(CameraAddress.isControllerUrl("http://192.168.1.99/car/", origin))
    }
}
