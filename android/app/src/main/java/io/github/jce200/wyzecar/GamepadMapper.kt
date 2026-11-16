package io.github.jce200.wyzecar

/** Digital drive input, matching the web controller: each value is -1, 0 or 1. */
data class DriveInput(val steer: Int, val throttle: Int) {
    companion object {
        val NEUTRAL = DriveInput(0, 0)
    }
}

/** Raw state of a physical gamepad. Axis values use Android's -1..1 range. */
data class GamepadState(
    val stickX: Float = 0f,
    val stickY: Float = 0f,
    val hatX: Float = 0f,
    val hatY: Float = 0f,
    val rightTrigger: Float = 0f,
    val leftTrigger: Float = 0f,
    val dpadLeft: Boolean = false,
    val dpadRight: Boolean = false,
    val dpadUp: Boolean = false,
    val dpadDown: Boolean = false,
)

/**
 * Maps a gamepad to the keyboard controls of the web controller. The
 * thresholds are the same as the page's own Gamepad API mapping.
 */
object GamepadMapper {
    private const val STICK = 0.38f
    private const val TRIGGER = 0.4f
    private const val HAT = 0.5f

    fun toDriveInput(state: GamepadState): DriveInput {
        val left = state.dpadLeft || state.hatX < -HAT || state.stickX < -STICK
        val right = state.dpadRight || state.hatX > HAT || state.stickX > STICK
        // Android reports "up" as a negative Y value.
        val forward = state.dpadUp || state.hatY < -HAT || state.rightTrigger > TRIGGER || state.stickY < -STICK
        val reverse = state.dpadDown || state.hatY > HAT || state.leftTrigger > TRIGGER || state.stickY > STICK
        return DriveInput(
            steer = (if (right) 1 else 0) - (if (left) 1 else 0),
            throttle = (if (forward) 1 else 0) - (if (reverse) 1 else 0),
        )
    }

    private fun keys(input: DriveInput): Set<String> = buildSet {
        if (input.steer < 0) add("ArrowLeft")
        if (input.steer > 0) add("ArrowRight")
        if (input.throttle > 0) add("ArrowUp")
        if (input.throttle < 0) add("ArrowDown")
    }

    /**
     * Key events that move the page from [old] to [new]. Releases come first
     * so the Car never briefly sees both directions pressed.
     */
    fun keyTransitions(old: DriveInput, new: DriveInput): List<Pair<String, Boolean>> {
        val before = keys(old)
        val after = keys(new)
        return (before - after).map { it to false } + (after - before).map { it to true }
    }
}
