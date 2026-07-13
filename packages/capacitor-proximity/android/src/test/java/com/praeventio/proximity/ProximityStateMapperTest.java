package com.praeventio.proximity;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ProximityStateMapperTest {

    @Test
    public void distanceBelowMaximumRangeIsNear() {
        assertTrue(ProximityStateMapper.isNear(0.5f, 5.0f));
    }

    @Test
    public void distanceAtOrAboveMaximumRangeIsFar() {
        assertFalse(ProximityStateMapper.isNear(5.0f, 5.0f));
        assertFalse(ProximityStateMapper.isNear(6.0f, 5.0f));
    }

    @Test
    public void invalidReadingsNeverCreateNearEvidence() {
        assertFalse(ProximityStateMapper.isNear(Float.NaN, 5.0f));
        assertFalse(ProximityStateMapper.isNear(Float.POSITIVE_INFINITY, 5.0f));
        assertFalse(ProximityStateMapper.isNear(0.5f, Float.NaN));
        assertFalse(ProximityStateMapper.isNear(0.5f, 0.0f));
    }
}
