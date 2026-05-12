// Praeventio Guard — Wire UI #74: <TaxIdInput />
//
// Input controlado para tax-id por país con validación en tiempo real
// (CL/BR/MX/AR/CO/US/GB). Muestra forma normalizada cuando es válido.

import { useState, useMemo, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle } from 'lucide-react';
import {
  validateGenericTaxId,
  type TaxIdValidationResult,
} from '../../services/identity/rutValidators.js';

interface TaxIdInputProps {
  /** Initial value. */
  initialValue?: string;
  /** ISO-3166 alpha-2 (CL/BR/MX/AR/CO/US/GB). */
  country: string;
  /** Fired whenever value changes (with validation result). */
  onValidate?: (raw: string, result: TaxIdValidationResult) => void;
  /** Optional label. */
  label?: string;
}

const PLACEHOLDERS: Record<string, string> = {
  CL: '12.345.678-9',
  BR: '111.444.777-35',
  MX: 'VECJ880326XXX',
  AR: '30-12345678-1',
  CO: '900123456-7',
  US: '123-45-6789',
  GB: 'AB123456C',
};

export function TaxIdInput({
  initialValue = '',
  country,
  onValidate,
  label,
}: TaxIdInputProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const [value, setValue] = useState(initialValue);

  const result = useMemo(() => {
    const r = validateGenericTaxId(value, country);
    onValidate?.(value, r);
    return r;
  }, [value, country, onValidate]);

  const tone =
    value.length === 0
      ? null
      : result.valid
        ? { Icon: CheckCircle2, color: 'text-emerald-500', border: 'border-emerald-500/50' }
        : { Icon: XCircle, color: 'text-rose-500', border: 'border-rose-500/50' };

  return (
    <div
      className="space-y-1"
      data-testid={`tax-id-input-${country.toLowerCase()}`}
    >
      <label htmlFor={inputId} className="text-[10px] uppercase text-secondary-token">
        {label ?? `${t('taxId.label', 'Tax ID')} (${country})`}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={PLACEHOLDERS[country.toUpperCase()] ?? ''}
          data-testid={`tax-id-field-${country.toLowerCase()}`}
          aria-invalid={value.length > 0 && !result.valid}
          className={`w-full text-xs rounded border bg-surface px-2 py-1 pr-7 ${
            tone?.border ?? 'border-default-token'
          }`}
        />
        {tone && (
          <tone.Icon
            className={`absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 ${tone.color}`}
            aria-hidden="true"
            data-testid={`tax-id-icon-${country.toLowerCase()}-${result.valid ? 'ok' : 'err'}`}
          />
        )}
      </div>
      {value.length > 0 && (
        <p
          className={`text-[10px] ${result.valid ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}
          data-testid={`tax-id-feedback-${country.toLowerCase()}`}
        >
          {result.valid
            ? `✓ ${t('taxId.normalized', 'Normalizado')}: ${result.normalized}`
            : `✗ ${result.reason}`}
        </p>
      )}
    </div>
  );
}
