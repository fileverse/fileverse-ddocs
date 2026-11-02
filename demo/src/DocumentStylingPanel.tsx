import React from 'react';
import type { DocumentStyling, DocumentStylingValue } from '../../package/types';
import { validateCustomCss } from '../../package/utils/sanitize-css';
import cn from 'classnames';

interface DocumentStylingPanelProps {
  isOpen: boolean;
  onClose: () => void;
  documentStyling: DocumentStyling | undefined;
  onStylingChange: (styling: DocumentStyling | undefined) => void;
  children?: React.ReactNode;
}

const GRADIENT_PRESETS = [
  {
    name: 'Purple Blue',
    value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
  {
    name: 'Pink Red',
    value: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  },
  {
    name: 'Blue Cyan',
    value: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  },
  {
    name: 'Orange Red',
    value: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  },
  {
    name: 'Green Blue',
    value: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  },
  {
    name: 'Purple Pink',
    value: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
  },
];

const FONT_OPTIONS = [
  { name: 'Inter', value: 'Inter, sans-serif' },
  { name: 'Arial', value: 'Arial, sans-serif' },
  { name: 'Georgia', value: 'Georgia, serif' },
  { name: 'Times New Roman', value: '"Times New Roman", serif' },
  { name: 'Helvetica', value: 'Helvetica, sans-serif' },
  { name: 'Courier New', value: '"Courier New", monospace' },
  { name: 'Roboto', value: 'Roboto, sans-serif' },
  { name: 'Open Sans', value: '"Open Sans", sans-serif' },
];

const CANVAS_COLOR_PRESETS = [
  { name: 'White', value: '#ffffff' },
  { name: 'Light Gray', value: '#f8f9fa' },
  { name: 'Cream', value: '#fefcf3' },
  { name: 'Light Blue', value: '#f0f8ff' },
  { name: 'Light Green', value: '#f0fff0' },
  { name: 'Light Pink', value: '#fff0f5' },
];

const TEXT_COLOR_PRESETS = [
  { name: 'Black', value: '#000000' },
  { name: 'Dark Gray', value: '#374151' },
  { name: 'Blue', value: '#1e40af' },
  { name: 'Green', value: '#059669' },
  { name: 'Purple', value: '#7c3aed' },
  { name: 'Red', value: '#dc2626' },
];

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const isHexColor = (value: string | undefined): value is string =>
  Boolean(value && HEX_COLOR_PATTERN.test(value));

const getColorInputValue = (
  value: DocumentStylingValue | undefined,
  fallback: string,
) => {
  if (typeof value === 'string') {
    return isHexColor(value) ? value : fallback;
  }

  return isHexColor(value?.light) ? value.light : fallback;
};

export const DocumentStylingPanel: React.FC<DocumentStylingPanelProps> = ({
  isOpen,
  onClose,
  documentStyling,
  onStylingChange,
  children,
}) => {
  if (!isOpen) return null;

  const currentStyling: DocumentStyling = documentStyling || {
    background: '#f8f9fa',
    canvasBackground: '#ffffff',
    textColor: '#000000',
    fontFamily: 'Inter',
  };

  const handleStylingUpdate = (updates: Partial<DocumentStyling>) => {
    onStylingChange({ ...currentStyling, ...updates });
  };

  // One general (non-blocking) message for the Custom CSS box. The sanitizer
  // returns per-issue diagnostics; we collapse them to two neutral variants so
  // the copy is never wrong: "removed for safety" (url()/@import/fixed/scope)
  // vs "couldn't be applied" (a syntax error). Specific reasons stay available
  // in the diagnostics array for the future if needed.
  const cssDiagnostics = validateCustomCss(currentStyling.customCSS).diagnostics;
  const hasCssError = cssDiagnostics.some((d) => d.level === 'error');
  const cssIssue = !cssDiagnostics.length
    ? null
    : {
        level: hasCssError ? ('error' as const) : ('warning' as const),
        message: hasCssError
          ? 'Some CSS couldn’t be applied. Check your syntax.'
          : 'Some styles were removed for safety.',
      };

  return (
    <div className="fixed top-[108px] left-4 z-50 bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-2xl backdrop-blur-sm max-w-sm max-h-[calc(100vh-120px)] overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Document Styling</h3>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
          aria-label="Close panel"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {children}
      <div className="space-y-4">
        {/* Page Background */}
        <div className="space-y-3">
          <label className="text-sm font-medium mb-2 block text-slate-700 dark:text-slate-200">
            Page Background
          </label>
          
          <div className="space-y-2">
            <input
              type="color"
              value={getColorInputValue(
                currentStyling.background,
                '#f8f9fa',
              )}
              onChange={(e) => handleStylingUpdate({ background: e.target.value })}
              className="w-full h-10 rounded-lg border-2 border-slate-200 dark:border-slate-600 cursor-pointer"
            />
            
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">
              Gradient Presets:
            </div>
            <div className="grid grid-cols-3 gap-2">
              {GRADIENT_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => handleStylingUpdate({ background: preset.value })}
                  className="aspect-square rounded-lg border-2 border-slate-200 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-400 hover:scale-105 transition-all duration-200 shadow-sm"
                  style={{ background: preset.value }}
                  title={preset.name}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Canvas Background */}
        <div className="space-y-3">
          <label className="text-sm font-medium mb-2 block text-slate-700 dark:text-slate-200">
            Canvas Background
          </label>
          
          <div className="space-y-2">
            <input
              type="color"
              value={getColorInputValue(
                currentStyling.canvasBackground,
                '#ffffff',
              )}
              onChange={(e) =>
                handleStylingUpdate({ canvasBackground: e.target.value })
              }
              className="w-full h-10 rounded-lg border-2 border-slate-200 dark:border-slate-600 cursor-pointer"
            />
            
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">
              Color Presets:
            </div>
            <div className="grid grid-cols-3 gap-2">
              {CANVAS_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => handleStylingUpdate({ canvasBackground: preset.value })}
                  className="aspect-square rounded-lg border-2 border-slate-200 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-400 hover:scale-105 transition-all duration-200 shadow-sm"
                  style={{ backgroundColor: preset.value }}
                  title={preset.name}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Text Color */}
        <div className="space-y-3">
          <label className="text-sm font-medium mb-2 block text-slate-700 dark:text-slate-200">
            Text Color
          </label>
          
          <div className="space-y-2">
            <input
              type="color"
              value={getColorInputValue(currentStyling.textColor, '#000000')}
              onChange={(e) => handleStylingUpdate({ textColor: e.target.value })}
              className="w-full h-10 rounded-lg border-2 border-slate-200 dark:border-slate-600 cursor-pointer"
            />
            
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">
              Color Presets:
            </div>
            <div className="grid grid-cols-3 gap-2">
              {TEXT_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => handleStylingUpdate({ textColor: preset.value })}
                  className="aspect-square rounded-lg border-2 border-slate-200 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-400 hover:scale-105 transition-all duration-200 shadow-sm"
                  style={{ backgroundColor: preset.value }}
                  title={preset.name}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Font Family */}
        <div className="space-y-3">
          <label className="text-sm font-medium mb-2 block text-slate-700 dark:text-slate-200">
            Font Family
          </label>

          <select
            value={currentStyling.fontFamily || 'Inter, sans-serif'}
            onChange={(e) => handleStylingUpdate({ fontFamily: e.target.value })}
            className="w-full p-3 text-sm border-2 border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:border-blue-500 focus:outline-none transition-colors"
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font.value} value={font.value} style={{ fontFamily: font.value }}>
                {font.name}
              </option>
            ))}
          </select>
        </div>

        {/* Canvas Orientation */}
        <div className="space-y-3">
          <label className="text-sm font-medium mb-2 block text-slate-700 dark:text-slate-200">
            Canvas Orientation
          </label>

          <div className="grid grid-cols-2 gap-3">
            {/* Portrait Option */}
            <button
              onClick={() => handleStylingUpdate({ orientation: 'portrait' })}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-200',
                currentStyling.orientation === 'portrait' || !currentStyling.orientation
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
                  : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/50'
              )}
              title="Portrait orientation"
            >
              <div className="w-8 h-11 border-2 border-slate-400 dark:border-slate-500 rounded" />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                Portrait
              </span>
            </button>

            {/* Landscape Option */}
            <button
              onClick={() => handleStylingUpdate({ orientation: 'landscape' })}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-200',
                currentStyling.orientation === 'landscape'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
                  : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/50'
              )}
              title="Landscape orientation"
            >
              <div className="w-11 h-8 border-2 border-slate-400 dark:border-slate-500 rounded" />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                Landscape
              </span>
            </button>
          </div>
        </div>

        {/* Custom CSS */}
        <div className="space-y-2">
          <label
            htmlFor="custom-css-input"
            className="text-sm font-medium block text-slate-700 dark:text-slate-200"
          >
            Custom CSS
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Add your own CSS to customize the appearance and layout of your doc.
          </p>
          <textarea
            id="custom-css-input"
            value={currentStyling.customCSS ?? ''}
            onChange={(e) => handleStylingUpdate({ customCSS: e.target.value })}
            spellCheck={false}
            placeholder={
              'body { font-family: Georgia, serif }\nh1 { letter-spacing: -0.02em }'
            }
            className="w-full h-32 p-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 resize-y focus:outline-none focus:border-blue-500"
          />
          {cssIssue && (
            <p
              className={cn(
                'text-xs flex gap-1.5 items-start',
                cssIssue.level === 'error'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-amber-600 dark:text-amber-500',
              )}
            >
              <span aria-hidden>{cssIssue.level === 'error' ? '⛔' : '⚠️'}</span>
              <span>{cssIssue.message}</span>
            </p>
          )}
        </div>

        {/* Reset Button */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-600">
          <button
            onClick={() => onStylingChange({})}
            className="w-full p-2 text-sm text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            Reset to Default
          </button>
        </div>
      </div>
    </div>
  );
};
