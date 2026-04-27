type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

interface LogEntry {
  severity: Severity;
  message: string;
  [key: string]: unknown;
}

const isProduction = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

function log(severity: Severity, message: string, meta?: Record<string, unknown>) {
  if (isProduction) {
    // Cloud Run: JSON to stdout → auto-ingested by Cloud Logging
    const entry: LogEntry = { severity, message, timestamp: new Date().toISOString(), ...meta };
    process.stdout?.write(JSON.stringify(entry) + '\n');
  } else {
    const label = `[${severity}]`;
    if (severity === 'ERROR' || severity === 'CRITICAL') {
      console.error(label, message, meta ?? '');
    } else if (severity === 'WARNING') {
      console.warn(label, message, meta ?? '');
    } else {
      console.log(label, message, meta ?? '');
    }
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log('DEBUG', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('INFO', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('WARNING', message, meta),
  error: (message: string, error?: unknown, meta?: Record<string, unknown>) => {
    const errorMeta = error instanceof Error
      ? { errorMessage: error.message, stack: error.stack }
      : error != null ? { error: String(error) } : {};
    log('ERROR', message, { ...errorMeta, ...meta });
  },
  critical: (message: string, error?: unknown, meta?: Record<string, unknown>) => {
    const errorMeta = error instanceof Error
      ? { errorMessage: error.message, stack: error.stack }
      : error != null ? { error: String(error) } : {};
    log('CRITICAL', message, { ...errorMeta, ...meta });
  },
};
