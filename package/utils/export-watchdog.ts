import type { ExportErrorContext } from '../types';

export type ExportErrorHandler = (
  error: unknown,
  context: ExportErrorContext,
) => void;

const EXPORT_TIMEOUT_MS = 60_000;

/** A catch cannot see an export that hangs, so report one still running after a minute. */
export const startExportWatchdog = (
  format: string,
  getStage: () => string,
  onExportError?: ExportErrorHandler,
): (() => void) => {
  if (!onExportError) return () => {};
  const timer = setTimeout(() => {
    const error = new Error('Export still running after 60s');
    error.name = 'ExportTimeoutError';
    onExportError(error, { format, stage: `timeout:${getStage()}` });
  }, EXPORT_TIMEOUT_MS);
  return () => clearTimeout(timer);
};
