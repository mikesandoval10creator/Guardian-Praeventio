// @vitest-environment jsdom
//
// Sprint 29 Bucket EE — RegulatoryCitation render tests.

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { RegulatoryCitation } from './RegulatoryCitation';

afterEach(() => cleanup());

describe('<RegulatoryCitation />', () => {
  it('renders ISO baseline only when no tenant country is provided', () => {
    const { getByTestId, container } = render(
      <RegulatoryCitation controlId="WORKER_PARTICIPATION" />,
    );
    const root = getByTestId('regulatory-citation');
    expect(root).toBeTruthy();
    expect(root.getAttribute('data-control-id')).toBe('WORKER_PARTICIPATION');
    // Debe contener al menos una chip ISO 45001:5.4
    expect(container.textContent ?? '').toContain('ISO-45001:5.4');
  });

  it('renders Chile + ISO citations for tenantCountry=CL', () => {
    const { container } = render(
      <RegulatoryCitation controlId="WORKER_PARTICIPATION" tenantCountry="CL" />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('ISO-45001:5.4');
    expect(text).toContain('DS-54');
    expect(text).toContain('Chile');
  });

  it('renders UK regulations when tenantCountry=GB', () => {
    const { container } = render(
      <RegulatoryCitation controlId="NONCONFORMITY_CORRECTIVE_ACTION" tenantCountry="GB" />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('RIDDOR-2013');
    expect(text).toContain('UK');
  });

  it('renders Australia regulations when tenantCountry=AU', () => {
    const { container } = render(
      <RegulatoryCitation controlId="EMERGENCY_PREPAREDNESS" tenantCountry="AU" />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('WHS-Reg-2011-r.43');
    expect(text).toContain('Australia');
  });

  it('renders Canada regulations when tenantCountry=CAN (alias)', () => {
    const { container } = render(
      <RegulatoryCitation controlId="HAZARD_IDENTIFICATION" tenantCountry="CAN" />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('WHMIS-2015');
    expect(text).toContain('Canadá');
  });

  it('returns null when controlId does not exist in the catalog', () => {
    const { container } = render(
      <RegulatoryCitation controlId="DOES_NOT_EXIST" tenantCountry="CL" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a custom label when provided', () => {
    const { container } = render(
      <RegulatoryCitation
        controlId="WORKER_PARTICIPATION"
        tenantCountry="CL"
        label="Marco regulatorio"
      />,
    );
    expect(container.textContent).toContain('Marco regulatorio');
  });

  it('long format includes the human-readable title with em-dash separator', () => {
    const { container } = render(
      <RegulatoryCitation
        controlId="WORKER_PARTICIPATION"
        tenantCountry="CL"
        format="long"
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain(' — ');
  });
});
