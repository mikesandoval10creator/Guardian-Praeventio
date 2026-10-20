// @vitest-environment jsdom
//
// Regression: turning the beacon off while getUserMedia is still pending must
// stop the late-arriving stream. Before the fix the cleanup ran with a null
// ref, then the awaited stream was assigned and a 500 ms torch interval was
// created after cleanup — camera/torch stayed on in an emergency.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({
  onSOS: undefined as undefined | (() => void),
  requestWakeLock: vi.fn(async () => undefined),
  releaseWakeLock: vi.fn(),
  getUserMedia: vi.fn(),
}));

vi.mock('../../hooks/useAcousticSOS', () => ({
  useAcousticSOS: (opts: { onSOS: () => void }) => {
    h.onSOS = opts.onSOS;
    return {
      isActive: false,
      noiseLevel: 0,
      start: vi.fn(),
      stop: vi.fn(),
    };
  },
}));

vi.mock('../../hooks/useWakeLock', () => ({
  useWakeLock: () => ({
    requestWakeLock: h.requestWakeLock,
    releaseWakeLock: h.releaseWakeLock,
    wakeLockFailed: false,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: (props: Record<string, unknown>) => {
      const {
        children,
        initial: _initial,
        animate: _animate,
        exit: _exit,
        transition: _transition,
        ...rest
      } = props;
      return React.createElement('div', rest, children as React.ReactNode);
    },
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import { SurvivalMode } from './SurvivalMode';

beforeEach(() => {
  h.getUserMedia.mockReset();
  h.requestWakeLock.mockClear();
  h.releaseWakeLock.mockClear();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: h.getUserMedia },
  });
});

afterEach(() => {
  cleanup();
});

describe('SurvivalMode — torch cleanup race', () => {
  it('stops a stream that resolves after the beacon was turned off', async () => {
    let resolveStream!: (stream: MediaStream) => void;
    const streamPromise = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    });
    const track = {
      stop: vi.fn(),
      applyConstraints: vi.fn(async () => undefined),
    };
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    h.getUserMedia.mockReturnValue(streamPromise);

    render(<SurvivalMode onClose={() => undefined} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'emergency.survival_btn_beacon' }),
    );
    await waitFor(() => expect(h.getUserMedia).toHaveBeenCalledTimes(1));

    // Turn it off before the camera permission/stream resolves.
    fireEvent.click(
      screen.getByRole('button', { name: 'emergency.survival_btn_beacon_on' }),
    );

    await act(async () => {
      resolveStream(stream);
      await streamPromise;
    });

    expect(track.stop).toHaveBeenCalledTimes(1);
  });
});
