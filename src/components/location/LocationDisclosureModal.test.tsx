// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocationDisclosureModal } from './LocationDisclosureModal';
import { LOCATION_DISCLOSURE_MESSAGE } from '../../services/location/locationPermissionRequest';

describe('LocationDisclosureModal', () => {
  it('no renderiza nada cuando está cerrado', () => {
    const { container } = render(
      <LocationDisclosureModal open={false} onAccept={() => {}} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('muestra la frase de divulgación exigida por Play cuando está abierto', () => {
    render(
      <LocationDisclosureModal open onAccept={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByTestId('location-disclosure-modal')).toBeInTheDocument();
    expect(screen.getByText(LOCATION_DISCLOSURE_MESSAGE)).toBeInTheDocument();
  });

  it('dispara onAccept al autorizar', async () => {
    const onAccept = vi.fn();
    render(<LocationDisclosureModal open onAccept={onAccept} onDismiss={() => {}} />);
    await userEvent.click(screen.getByTestId('location-disclosure-accept'));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('dispara onDismiss al rechazar', async () => {
    const onDismiss = vi.fn();
    render(<LocationDisclosureModal open onAccept={() => {}} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByTestId('location-disclosure-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
