// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { EmergencyAuthorityCallPanel } from './EmergencyAuthorityCallPanel';

afterEach(cleanup);

const telHrefs = () =>
  Array.from(document.querySelectorAll('a[href^="tel:"]')).map((a) =>
    a.getAttribute('href'),
  );

describe('EmergencyAuthorityCallPanel', () => {
  it('renders Chilean 131/132/133 as tel: links for regionCode CL', () => {
    render(<EmergencyAuthorityCallPanel regionCode="CL" />);
    const hrefs = telHrefs();
    expect(hrefs).toContain('tel:131');
    expect(hrefs).toContain('tel:132');
    expect(hrefs).toContain('tel:133');
  });

  it('resolves numbers from GPS coords when no regionCode (Argentina bbox)', () => {
    render(<EmergencyAuthorityCallPanel coords={{ lat: -34.6, lng: -58.4 }} />);
    // AR: medical 107, fire 100, police 911
    const hrefs = telHrefs();
    expect(hrefs).toContain('tel:107');
    expect(hrefs).toContain('tel:100');
  });

  it('falls back to Chile when neither region nor coords are given', () => {
    render(<EmergencyAuthorityCallPanel />);
    expect(telHrefs()).toContain('tel:131');
  });

  it('never triggers an automatic side effect — only tel: anchors, no auto-dial', () => {
    render(<EmergencyAuthorityCallPanel regionCode="CL" />);
    // Every actionable element is a plain tel: anchor the user must tap.
    const anchors = Array.from(document.querySelectorAll('a'));
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.every((a) => (a.getAttribute('href') ?? '').startsWith('tel:'))).toBe(true);
    expect(document.querySelectorAll('button').length).toBe(0);
  });
});
