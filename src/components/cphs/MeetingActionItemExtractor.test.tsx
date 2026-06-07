// @vitest-environment jsdom
//
// Wiring test for <MeetingActionItemExtractor /> (B12): proves the orphaned
// meeting-pack `extract-action-items` endpoint is now reachable from the CPHS
// UI — extract calls the server with the text, suggestions render, and
// accepting one maps it to an acuerdo via onAdd.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';

const H = vi.hoisted(() => ({ extract: vi.fn() }));

vi.mock('../../hooks/useMeetingPack', () => ({
  extractMeetingActionItems: (...a: unknown[]) => H.extract(...a),
}));
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _k),
  }),
}));

import { MeetingActionItemExtractor } from './MeetingActionItemExtractor';

beforeEach(() => {
  H.extract.mockReset();
});
afterEach(() => cleanup());

describe('MeetingActionItemExtractor', () => {
  it('extracts action items from the text and renders the suggestions', async () => {
    H.extract.mockResolvedValue({
      suggestions: [
        { description: 'Revisar el andamio del sector B', triggerPhrase: 'debe revisar', proposedDueDate: '2026-06-12T00:00:00.000Z', confidence: 0.85 },
        { description: 'Reponer extintores vencidos', triggerPhrase: 'hay que', confidence: 0.7 },
      ],
    });
    render(<MeetingActionItemExtractor projectId="p1" onAdd={vi.fn()} />);

    fireEvent.change(screen.getByTestId('meeting-action-text'), {
      target: { value: 'El supervisor debe revisar el andamio. Hay que reponer extintores.' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('meeting-action-extract-btn'));
    });

    expect(H.extract).toHaveBeenCalledWith('p1', {
      text: 'El supervisor debe revisar el andamio. Hay que reponer extintores.',
    });
    expect(screen.getByTestId('meeting-action-item-0')).toHaveTextContent('Revisar el andamio del sector B');
    expect(screen.getByTestId('meeting-action-item-1')).toHaveTextContent('Reponer extintores vencidos');
  });

  it('maps an accepted suggestion to an acuerdo via onAdd (description + due date)', async () => {
    const onAdd = vi.fn();
    H.extract.mockResolvedValue({
      suggestions: [
        { description: 'Revisar el andamio', triggerPhrase: 'debe', proposedAssigneeUid: 'u-9', proposedDueDate: '2026-06-12T10:00:00.000Z', confidence: 0.9 },
      ],
    });
    render(<MeetingActionItemExtractor projectId="p1" onAdd={onAdd} />);

    fireEvent.change(screen.getByTestId('meeting-action-text'), { target: { value: 'debe revisar el andamio' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('meeting-action-extract-btn'));
    });
    fireEvent.click(screen.getByTestId('meeting-action-add-0'));

    expect(onAdd).toHaveBeenCalledWith({
      descripcion: 'Revisar el andamio',
      responsable: 'u-9',
      fechaPlazo: '2026-06-12',
    });
  });

  it('shows an honest empty state when no actions are detected', async () => {
    H.extract.mockResolvedValue({ suggestions: [] });
    render(<MeetingActionItemExtractor projectId="p1" onAdd={vi.fn()} />);
    fireEvent.change(screen.getByTestId('meeting-action-text'), { target: { value: 'Reunión sin acuerdos.' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('meeting-action-extract-btn'));
    });
    expect(screen.getByTestId('meeting-action-empty')).toBeInTheDocument();
  });

  it('does not call the server with empty text (button disabled)', () => {
    render(<MeetingActionItemExtractor projectId="p1" onAdd={vi.fn()} />);
    expect(screen.getByTestId('meeting-action-extract-btn')).toBeDisabled();
  });
});
