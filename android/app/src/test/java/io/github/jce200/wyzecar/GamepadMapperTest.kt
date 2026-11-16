package io.github.jce200.wyzecar

import org.junit.Assert.assertEquals
import org.junit.Test

class GamepadMapperTest {
    @Test
    fun idleGamepadIsNeutral() {
        assertEquals(DriveInput.NEUTRAL, GamepadMapper.toDriveInput(GamepadState()))
        assertEquals(DriveInput.NEUTRAL, GamepadMapper.toDriveInput(GamepadState(stickX = 0.3f, stickY = -0.3f)))
    }

    @Test
    fun stickHatTriggersAndDpadDrive() {
        assertEquals(DriveInput(0, 1), GamepadMapper.toDriveInput(GamepadState(stickY = -0.9f)))
        assertEquals(DriveInput(-1, -1), GamepadMapper.toDriveInput(GamepadState(stickX = -1f, stickY = 1f)))
        assertEquals(DriveInput(1, 0), GamepadMapper.toDriveInput(GamepadState(hatX = 1f)))
        assertEquals(DriveInput(0, 1), GamepadMapper.toDriveInput(GamepadState(rightTrigger = 0.8f)))
        assertEquals(DriveInput(0, -1), GamepadMapper.toDriveInput(GamepadState(leftTrigger = 0.8f)))
        assertEquals(DriveInput(-1, 1), GamepadMapper.toDriveInput(GamepadState(dpadLeft = true, dpadUp = true)))
    }

    @Test
    fun opposingInputsCancelOut() {
        assertEquals(
            DriveInput.NEUTRAL,
            GamepadMapper.toDriveInput(GamepadState(rightTrigger = 1f, leftTrigger = 1f, dpadLeft = true, dpadRight = true)),
        )
    }

    @Test
    fun transitionsReleaseBeforePressing() {
        assertEquals(
            listOf("ArrowUp" to true),
            GamepadMapper.keyTransitions(DriveInput.NEUTRAL, DriveInput(0, 1)),
        )
        assertEquals(
            listOf("ArrowUp" to false, "ArrowDown" to true),
            GamepadMapper.keyTransitions(DriveInput(1, 1), DriveInput(1, -1)),
        )
        assertEquals(
            listOf("ArrowLeft" to false, "ArrowDown" to false),
            GamepadMapper.keyTransitions(DriveInput(-1, -1), DriveInput.NEUTRAL),
        )
        assertEquals(emptyList<Pair<String, Boolean>>(), GamepadMapper.keyTransitions(DriveInput(1, 0), DriveInput(1, 0)))
    }
}
