/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { LucideIcon, useTheme } from '@fileverse/ui';

/**
 * Designer tuning panel for the Palm atmosphere (demo only, TEC-3020).
 *
 * Shown when the page URL carries `?palmTuning=1`. Sliders write the four
 * atmosphere variables live and mirror them into the URL, so a tuned look can
 * be shared as a link and read straight into the stylesheet defaults.
 */

export interface PalmTuning {
  /** Frond darkness, 0 to 1. */
  shadow: number;
  /** Sun wash strength, 0 to 1. */
  sun: number;
  /** Frond blur radius in px. */
  blur: number;
  /** Frond contrast multiplier. */
  contrast: number;
}

/** Keep in sync with the defaults in palm-atmosphere.css. */
export const PALM_DEFAULTS: PalmTuning = {
  shadow: 0.22,
  sun: 0.42,
  blur: 9,
  contrast: 1.15,
};

const FLAG = 'palmTuning';
const KEYS: (keyof PalmTuning)[] = ['shadow', 'sun', 'blur', 'contrast'];

const readUrl = (): { enabled: boolean; values: PalmTuning } => {
  if (typeof window === 'undefined') {
    return { enabled: false, values: PALM_DEFAULTS };
  }
  const params = new URLSearchParams(window.location.search);
  const values = { ...PALM_DEFAULTS };
  for (const key of KEYS) {
    const raw = params.get(key);
    const n = raw === null ? NaN : Number(raw);
    if (Number.isFinite(n)) values[key] = n;
  }
  return { enabled: params.has(FLAG), values };
};

const writeUrl = (values: PalmTuning) => {
  const url = new URL(window.location.href);
  url.searchParams.set(FLAG, '1');
  for (const key of KEYS) url.searchParams.set(key, String(values[key]));
  window.history.replaceState(null, '', url);
};

interface PalmTuningContextValue {
  enabled: boolean;
  values: PalmTuning;
  set: (patch: Partial<PalmTuning>) => void;
  reset: () => void;
}

const PalmTuningContext = createContext<PalmTuningContextValue | null>(null);

export const PalmTuningProvider = ({ children }: { children: ReactNode }) => {
  const [{ enabled, values }, setState] = useState(readUrl);

  const set = useCallback((patch: Partial<PalmTuning>) => {
    setState((prev) => {
      const next = { ...prev.values, ...patch };
      writeUrl(next);
      return { ...prev, values: next };
    });
  }, []);

  const reset = useCallback(() => {
    writeUrl(PALM_DEFAULTS);
    setState((prev) => ({ ...prev, values: PALM_DEFAULTS }));
  }, []);

  const value = useMemo(
    () => ({ enabled, values, set, reset }),
    [enabled, values, set, reset],
  );

  return (
    <PalmTuningContext.Provider value={value}>
      {children}
    </PalmTuningContext.Provider>
  );
};

/** Null outside the provider or when the flag is off. */
export const usePalmTuning = () => {
  const ctx = useContext(PalmTuningContext);
  return ctx && ctx.enabled ? ctx : null;
};

/** The atmosphere variables as inline style, or undefined when not tuning. */
export const usePalmTuningStyle = (): React.CSSProperties | undefined => {
  const tuning = usePalmTuning();
  if (!tuning) return undefined;
  const { shadow, sun, blur, contrast } = tuning.values;
  return {
    '--palm-shadow-opacity': String(shadow),
    '--palm-sun-opacity': String(sun),
    '--palm-softness': `${blur}px`,
    '--palm-contrast': String(contrast),
  } as React.CSSProperties;
};

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}

const Slider = ({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: SliderProps) => (
  <label className="flex items-center gap-2">
    <span className="text-helper-text-sm color-text-default whitespace-nowrap">
      {label}
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="palm-tuning__range"
      aria-label={label}
    />
    <span className="text-helper-text-sm color-text-secondary w-10 tabular-nums">
      {display}
    </span>
  </label>
);

export const PalmTuningPanel = () => {
  const tuning = usePalmTuning();
  const { theme } = useTheme();
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (!tuning) return null;
  const { values, set, reset } = tuning;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      /* clipboard blocked; the URL bar already holds the values */
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open palm tuning"
        className="palm-tuning fixed right-4 bottom-10 z-[60] flex h-8 w-10 items-center justify-center rounded-lg border color-border-default color-bg-default shadow-elevation-3"
      >
        <LucideIcon name="SlidersHorizontal" size="sm" />
      </button>
    );
  }

  return (
    <div className="palm-tuning fixed right-4 bottom-10 z-[60] flex items-center gap-4 rounded-lg border color-border-default color-bg-default px-3 py-2 shadow-elevation-3">
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Collapse palm tuning"
        className="flex h-4 w-4 items-center justify-center rounded"
      >
        <LucideIcon name="ChevronRight" size="sm" />
      </button>
      {theme !== 'theme-palm' && (
        <span className="text-helper-text-sm color-text-secondary">
          Pick the Palm theme to see changes
        </span>
      )}
      <Slider
        label="Shadow"
        value={Math.round(values.shadow * 100)}
        min={0}
        max={100}
        step={1}
        display={values.shadow.toFixed(2)}
        onChange={(v) => set({ shadow: v / 100 })}
      />
      <Slider
        label="Sun"
        value={Math.round(values.sun * 100)}
        min={0}
        max={100}
        step={1}
        display={values.sun.toFixed(2)}
        onChange={(v) => set({ sun: v / 100 })}
      />
      <Slider
        label="Soften"
        value={values.blur}
        min={0}
        max={20}
        step={0.5}
        display={`${values.blur}px`}
        onChange={(v) => set({ blur: v })}
      />
      <Slider
        label="Contrast"
        value={Math.round(values.contrast * 100)}
        min={100}
        max={160}
        step={1}
        display={values.contrast.toFixed(2)}
        onChange={(v) => set({ contrast: v / 100 })}
      />
      <button
        type="button"
        onClick={copyLink}
        className="flex items-center gap-1 rounded px-2 py-1 text-helper-text-sm color-text-default hover:color-bg-default-hover"
      >
        <LucideIcon name={copied ? 'Check' : 'Copy'} size="sm" />
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <button
        type="button"
        onClick={reset}
        aria-label="Reset to defaults"
        className="flex items-center gap-1 rounded px-2 py-1 text-helper-text-sm color-text-secondary hover:color-bg-default-hover"
      >
        <LucideIcon name="RotateCcw" size="sm" />
        Reset
      </button>
    </div>
  );
};
