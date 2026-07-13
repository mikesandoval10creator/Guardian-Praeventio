package com.praeventio.proximity;

/** SDK-free executable contract for local and CI verification with plain javac. */
public final class ProximityStateMapperSelfTest {
    private ProximityStateMapperSelfTest() {}

    public static void main(String[] args) {
        assertState(true, ProximityStateMapper.isNear(0.5f, 5.0f), "below maximum");
        assertState(false, ProximityStateMapper.isNear(5.0f, 5.0f), "equal maximum");
        assertState(false, ProximityStateMapper.isNear(6.0f, 5.0f), "above maximum");
        assertState(false, ProximityStateMapper.isNear(Float.NaN, 5.0f), "NaN distance");
        assertState(false, ProximityStateMapper.isNear(Float.POSITIVE_INFINITY, 5.0f), "infinite distance");
        assertState(false, ProximityStateMapper.isNear(0.5f, Float.NaN), "NaN maximum");
        assertState(false, ProximityStateMapper.isNear(0.5f, 0.0f), "zero maximum");
    }

    private static void assertState(boolean expected, boolean actual, String scenario) {
        if (expected != actual) {
            throw new AssertionError(scenario + ": expected " + expected + " but got " + actual);
        }
    }
}
