package com.praeventio.proximity;

/** Pure boundary rule shared by production sensor handling and SDK-free tests. */
public final class ProximityStateMapper {
    private ProximityStateMapper() {}

    public static boolean isNear(float distance, float maximumRange) {
        return Float.isFinite(distance)
            && Float.isFinite(maximumRange)
            && maximumRange > 0.0f
            && distance >= 0.0f
            && distance < maximumRange;
    }
}
