// @vitest-environment jsdom
// B14 — launcher flotante del asistente resiliente. Pina:
//   1. Botón burbuja visible al montar (ventana cerrada).
//   2. Click → abre la ventana con el panel resiliente.
//   3. Evento global `open-ai-chat` → abre y pre-carga `detail.query`.
//   4. Botón cerrar → vuelve al estado burbuja.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';

vi.mock('./ResilientAsesorPanel', () => ({
  ResilientAsesorPanel: (props: { initialDraft?: string }) => (
    <div data-testid="panel-mock" data-initial-draft={props.initialDraft ?? ''}>
      panel
    </div>
  ),
}));

import { ResilientAsesorLauncher } from './ResilientAsesorLauncher';

describe('<ResilientAsesorLauncher />', () => {
  it('renderiza el botón flotante y NO la ventana al montar', () => {
    render(<ResilientAsesorLauncher />);
    expect(
      screen.getByTestId('resilient-asesor-launcher'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('resilient-asesor-window')).toBeNull();
  });

  it('click en la burbuja abre la ventana con el panel', () => {
    render(<ResilientAsesorLauncher />);
    fireEvent.click(screen.getByTestId('resilient-asesor-launcher'));
    expect(screen.getByTestId('resilient-asesor-window')).toBeInTheDocument();
    expect(screen.getByTestId('panel-mock')).toBeInTheDocument();
    expect(screen.getByText('El Guardián')).toBeInTheDocument();
  });

  it('el evento global open-ai-chat abre la ventana y pre-carga la consulta', async () => {
    render(<ResilientAsesorLauncher />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('open-ai-chat', {
          detail: { query: '¿qué EPP necesito para altura?' },
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('resilient-asesor-window')).toBeInTheDocument();
    });
    expect(screen.getByTestId('panel-mock').dataset.initialDraft).toBe(
      '¿qué EPP necesito para altura?',
    );
  });

  it('el botón cerrar vuelve al estado burbuja', () => {
    render(<ResilientAsesorLauncher />);
    fireEvent.click(screen.getByTestId('resilient-asesor-launcher'));
    fireEvent.click(screen.getByLabelText('Cerrar asistente'));
    expect(screen.queryByTestId('resilient-asesor-window')).toBeNull();
    expect(
      screen.getByTestId('resilient-asesor-launcher'),
    ).toBeInTheDocument();
  });
});
