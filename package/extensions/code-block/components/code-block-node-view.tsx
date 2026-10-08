import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  cn,
  LucideIcon,
  Tooltip,
  toast,
  Button,
  Toggle,
} from '@fileverse/ui';
import { NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react';
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { useResponsive } from '../../../utils/responsive';
import { useEditingContext } from '../../../hooks/use-editing-context';
import { getMermaid } from '../lazy-mermaid';

const LANGUAGE_GROUPS = [
  {
    label: 'Web',
    options: [
      { label: 'HTML', value: 'html' },
      { label: 'CSS', value: 'css' },
      { label: 'JavaScript', value: 'js' },
      { label: 'TypeScript', value: 'ts' },
      { label: 'JSX', value: 'jsx' },
      { label: 'TSX', value: 'tsx' },
      { label: 'JSON', value: 'json' },
      { label: 'Markdown', value: 'md' },
    ],
  },
  {
    label: 'Systems',
    options: [
      { label: 'C', value: 'c' },
      { label: 'C++', value: 'cpp' },
      { label: 'Rust', value: 'rust' },
      { label: 'Go', value: 'go' },
    ],
  },
  {
    label: 'Scripting',
    options: [
      { label: 'Python', value: 'python' },
      { label: 'Bash', value: 'bash' },
      { label: 'Ruby', value: 'ruby' },
      { label: 'PHP', value: 'php' },
    ],
  },
  {
    label: 'Data',
    options: [
      { label: 'SQL', value: 'sql' },
      { label: 'YAML', value: 'yaml' },
      { label: 'XML', value: 'xml' },
    ],
  },
  {
    label: 'Build',
    options: [{ label: 'Makefile', value: 'makefile' }],
  },
  {
    label: 'JVM',
    options: [
      { label: 'Java', value: 'java' },
      { label: 'Kotlin', value: 'kotlin' },
    ],
  },
  {
    label: 'Apple',
    options: [
      { label: 'Swift', value: 'swift' },
      { label: 'Objective-C', value: 'objectivec' },
    ],
  },
  {
    label: 'Blockchain',
    options: [{ label: 'Solidity', value: 'solidity' }],
  },
  {
    label: 'Diagrams',
    options: [{ label: 'Mermaid', value: 'mermaid' }],
  },
  {
    label: 'Other',
    options: [
      { label: 'Plain Text', value: 'plaintext' },
      { label: 'LaTeX', value: 'tex' },
    ],
  },
];
const TAB_SIZES = [2, 4, 8];

type MermaidState = {
  view: 'source' | 'preview';
  error: string | null;
  svg: string;
};
type MermaidAction =
  | { type: 'toggleView' }
  | { type: 'setView'; view: 'source' | 'preview' }
  | { type: 'parsed' }
  | { type: 'rendered'; svg: string }
  | { type: 'failed'; error: string }
  | { type: 'reset' };

const initialMermaidState: MermaidState = {
  view: 'source',
  error: null,
  svg: '',
};

export default function CodeBlockNodeView({
  node,
  updateAttributes,
  editor,
  deleteNode,
}: NodeViewProps) {
  const codeRef = useRef<HTMLDivElement>(null);
  const [copyIcon, setCopyIcon] = useState<'Copy' | 'Check'>('Copy');
  const { isSuggestionMode } = useEditingContext();
  // Read attributes with sensible defaults
  const language = node.attrs.language || 'plaintext';
  const isMermaid = language === 'mermaid';
  const isPreviewMode = !editor.isEditable || !!isSuggestionMode;
  const lineNumbers = node.attrs.lineNumbers && !isPreviewMode && !isMermaid;
  const wordWrap = node.attrs.wordWrap && !isPreviewMode && !isMermaid;
  const tabSize = node.attrs.tabSize ?? 2;
  const shouldFocus = node.attrs.shouldFocus;
  const { isMobile } = useResponsive();

  const code = node.textContent || node.attrs.code || '';

  const mermaidContainerRef = useRef<HTMLDivElement>(null);
  const mermaidId = `mermaid-${useId().replace(/:/g, '')}`;

  const [mermaidState, dispatchMermaid] = useReducer(
    (state: MermaidState, action: MermaidAction): MermaidState => {
      switch (action.type) {
        case 'toggleView': {
          if (typeof state.error === 'string') {
            return state;
          }
          return state.view === 'preview'
            ? { ...state, view: 'source' }
            : { ...state, view: 'preview' };
        }
        case 'setView':
          return state.view === action.view
            ? state
            : { ...state, view: action.view };
        case 'parsed':
          return state.error === null ? state : { ...state, error: null };
        case 'rendered':
          return { ...state, error: null, svg: action.svg };
        case 'failed':
          return state.error === action.error
            ? state
            : { ...state, error: action.error };
        case 'reset':
          return initialMermaidState;
      }
    },
    initialMermaidState,
  );

  const {
    view: mermaidView,
    error: mermaidError,
    svg: mermaidSvg,
  } = mermaidState;
  const showMermaidPreview = isMermaid && mermaidView === 'preview';

  // Cache last successful render to avoid re-rendering on toggle when source
  // hasn't changed, and to render immediately on toggle without debounce.
  const lastRenderedRef = useRef<{ source: string; svg: string }>({
    source: '',
    svg: '',
  });
  const prevViewRef = useRef(mermaidView);

  useEffect(() => {
    if (!isMermaid) return;
    if (!code.trim()) {
      if (mermaidError) dispatchMermaid({ type: 'parsed' });
      return;
    }

    const isPreview = mermaidView === 'preview' || isPreviewMode;
    const justToggledToPreview = isPreview && prevViewRef.current === 'source';
    prevViewRef.current = mermaidView;

    // Cache hit: previewing source we already rendered. No work, no flicker.
    if (
      isPreview &&
      lastRenderedRef.current.source === code &&
      lastRenderedRef.current.svg
    ) {
      if (mermaidSvg !== lastRenderedRef.current.svg) {
        dispatchMermaid({ type: 'rendered', svg: lastRenderedRef.current.svg });
      }
      return;
    }

    // Render immediately when the user just clicked Preview; debounce edits.
    const delay = justToggledToPreview ? 0 : 400;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const mermaid = await getMermaid();
        if (isPreview) {
          const { svg } = await mermaid.render(mermaidId, code);
          if (cancelled) return;
          lastRenderedRef.current = { source: code, svg };
          dispatchMermaid({ type: 'rendered', svg });
        } else {
          await mermaid.parse(code);
          if (!cancelled) dispatchMermaid({ type: 'parsed' });
        }
      } catch (err) {
        if (!cancelled) {
          dispatchMermaid({
            type: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // mermaidSvg/mermaidError are read but not deps — using them as deps would
    // re-run after every dispatch. The reducer no-ops when nothing changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, isMermaid, mermaidView, isPreviewMode, mermaidId]);

  useEffect(() => {
    if (!isMermaid) {
      lastRenderedRef.current = { source: '', svg: '' };
      dispatchMermaid({ type: 'reset' });
    }
  }, [isMermaid]);

  useEffect(() => {
    if (!isPreviewMode) return;
    if (mermaidError) {
      dispatchMermaid({
        type: 'setView',
        view: 'source',
      });
    } else {
      dispatchMermaid({
        type: 'setView',
        view: 'preview',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreviewMode, mermaidError]);

  const codeLines = useMemo(() => {
    const lines = code.split('\n');
    const processedLines: string[] = [];

    let maxLineLength = 0;

    if (wordWrap) {
      // For mobile: 330px width - 16px padding (4px on each side) - 24px for line numbers if enabled
      // Assuming average monospace character width of ~8px
      maxLineLength = isMobile
        ? Math.floor((330 - 16 - (lineNumbers ? 24 : 0)) / 8)
        : 79;
    } else {
      maxLineLength = isMobile ? 85 : 85;
    }

    for (const line of lines) {
      if (line.length > maxLineLength) {
        // Split the line into multiple lines of max 80 characters
        const wrappedLines =
          line.match(new RegExp(`.{1,${maxLineLength}}`, 'g')) || [];
        processedLines.push(...wrappedLines);
      } else {
        processedLines.push(line);
      }
    }
    return processedLines;
  }, [code, isMobile, wordWrap, lineNumbers]);

  useEffect(() => {
    if (shouldFocus && codeRef.current) {
      codeRef.current.focus();
      // Reset shouldFocus after focusing
      updateAttributes({ shouldFocus: false });
    }
  }, [shouldFocus, updateAttributes]);

  // Add focus handler to maintain focus state
  const handleFocus = () => {
    updateAttributes({ shouldFocus: true });
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(code);
    setCopyIcon('Check');
    toast({
      customIcon: 'Copy',
      iconType: 'icon',
      title: 'Code copied to clipboard',
      variant: 'success',
      toastType: 'mini',
    });

    const timeout = setTimeout(() => {
      setCopyIcon('Copy');
    }, 3000);

    return () => clearTimeout(timeout);
  };

  return (
    <NodeViewWrapper className="w-full">
      <pre
        className={cn(
          'rounded-lg overflow-clip border color-border-default w-full relative',
          showMermaidPreview && '!bg-white !bg-clip-padding',
        )}
      >
        <div
          className={cn(
            'flex flex-row gap-2 items-center justify-between color-bg-secondary absolute top-0 left-0 z-10 w-full border-b color-border-default px-2 py-1',
            isPreviewMode && !isMermaid && 'hidden',
          )}
          contentEditable="false"
        >
          <div className="flex flex-row gap-0 items-center">
            {/* Language select */}
            {isPreviewMode ? (
              <span className="text-helper-text-sm px-2 py-1">
                {language || '-'}
              </span>
            ) : (
              <Select
                value={language}
                onValueChange={(value: string) =>
                  updateAttributes({ language: value })
                }
              >
                <SelectTrigger className="!min-w-24 text-helper-text-sm h-7 px-2 py-1 color-bg-secondary border-none">
                  <Tooltip text="Select language">
                    <SelectValue placeholder="Select language" />
                    <span className="w-1"></span>
                  </Tooltip>
                </SelectTrigger>
                <SelectContent className="min-w-fit" showScrollButtons={false}>
                  {LANGUAGE_GROUPS.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectLabel>{group.label}</SelectLabel>
                      {group.options.map((opt) => (
                        <SelectItem
                          key={opt.value}
                          value={opt.value}
                          className="text-helper-text-sm"
                        >
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="w-[1px] h-4 vertical-divider mx-1"></div>

            {/* Toolbar */}
            <Tooltip
              text="Copy code"
              onMouseDown={(e) => e.preventDefault()}
              asTriggerChild={true}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyCode}
                onMouseDown={(e) => e.preventDefault()}
                className="min-w-fit p-2 relative select-none"
              >
                <div className="relative w-4 h-4">
                  <LucideIcon
                    name={copyIcon}
                    size="sm"
                    className={cn(
                      'transition-all duration-300 absolute inset-0',
                      copyIcon === 'Check'
                        ? 'opacity-100 scale-100'
                        : 'opacity-0 scale-0',
                    )}
                  />
                  <LucideIcon
                    name="Copy"
                    size="sm"
                    className={cn(
                      'transition-all duration-300 absolute inset-0',
                      copyIcon === 'Check'
                        ? 'opacity-0 scale-0'
                        : 'opacity-100 scale-100',
                    )}
                  />
                </div>
              </Button>
            </Tooltip>
            <div className="w-[1px] h-4 vertical-divider mx-1"></div>

            {!isMermaid && (
              <>
                <Tooltip text="Line numbers">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updateAttributes({ lineNumbers: !lineNumbers })
                    }
                    className={cn(
                      'min-w-fit p-2',
                      lineNumbers &&
                        'color-bg-brand color-text-on-brand hover:bg-[hsla(var(--color-bg-brand-hover))]',
                    )}
                  >
                    <LucideIcon name="List" size="sm" />
                  </Button>
                </Tooltip>
                <div className="w-[1px] h-4 vertical-divider mx-1"></div>

                <Tooltip text="Word wrap">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => updateAttributes({ wordWrap: !wordWrap })}
                    className={cn(
                      'min-w-fit p-2',
                      wordWrap &&
                        'color-bg-brand color-text-on-brand hover:bg-[hsla(var(--color-bg-brand-hover))]',
                    )}
                  >
                    <LucideIcon name="WrapText" size="sm" />
                  </Button>
                </Tooltip>
                <div className="w-[1px] h-4 vertical-divider mx-1"></div>

                <Select
                  value={String(tabSize)}
                  onValueChange={(value: string) =>
                    updateAttributes({ tabSize: Number(value) })
                  }
                >
                  <SelectTrigger className="w-full text-helper-text-sm h-7 px-2 py-1 color-bg-secondary border-none">
                    <Tooltip text="Tab size">
                      <span className="!hidden ddoc-sm:!block">
                        Tab: {tabSize}
                      </span>
                      <span className="!block ddoc-sm:!hidden">{tabSize}</span>
                    </Tooltip>
                  </SelectTrigger>
                  <SelectContent
                    className="min-w-[60px] max-h-60 overflow-y-auto "
                    showScrollButtons={false}
                  >
                    {TAB_SIZES.map((size) => (
                      <SelectItem
                        key={size}
                        value={String(size)}
                        className="text-helper-text-sm"
                      >
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}

            {isMermaid && (
              <div className="flex gap-1 items-center">
                <div className="grid grid-cols-2 grid-rows-1 shrink-0 items-center justify-items-center">
                  <Toggle
                    title={
                      mermaidError
                        ? ''
                        : mermaidView === 'preview'
                          ? 'Switch to source view'
                          : 'Switch to preview'
                    }
                    className="col-start-1 col-end-3 row-start-1 row-end-2 data-[state=checked]:bg-[hsl(var(--color-bg-disabled))] data-[state=checked]:hover:enabled:bg-[hsl(var(--color-bg-disabled))]"
                    contentEditable="false"
                    checked={mermaidView === 'preview'}
                    disabled={!!mermaidError}
                    onCheckedChange={() =>
                      dispatchMermaid({
                        type: 'toggleView',
                      })
                    }
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.currentTarget.focus();
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault();
                      e.currentTarget.focus();
                    }}
                  />
                  <LucideIcon
                    name="Code"
                    size={'sm'}
                    className="col-start-1 col-end-2 row-start-1 row-end-2 pointer-events-none"
                  />
                  {mermaidError ? (
                    <LucideIcon
                      name="TriangleAlert"
                      size="sm"
                      className="col-start-2 col-end-3 row-start-1 row-end-2 pointer-events-none"
                    />
                  ) : (
                    <LucideIcon
                      name="Eye"
                      size={'sm'}
                      className="col-start-2 col-end-3 row-start-1 row-end-2 pointer-events-none"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
          {!isPreviewMode && (
            <Tooltip text="Delete code block">
              <LucideIcon
                name="Trash2"
                size="sm"
                className="mr-1"
                onClick={() => deleteNode()}
              />
            </Tooltip>
          )}
        </div>
        <div
          className={cn(
            'absolute top-3 right-3 hidden z-10 color-bg-default',
            isPreviewMode && !isMermaid && 'flex',
          )}
        >
          <Tooltip text="Copy code">
            <div className="relative w-4 h-4" onClick={handleCopyCode}>
              <LucideIcon
                name={copyIcon}
                size="sm"
                className={cn(
                  'transition-all duration-200 absolute inset-0',
                  copyIcon === 'Check'
                    ? 'opacity-100 scale-100'
                    : 'opacity-0 scale-50',
                )}
              />
              <LucideIcon
                name="Copy"
                size="sm"
                className={cn(
                  'transition-all duration-200 absolute inset-0',
                  copyIcon === 'Check'
                    ? 'opacity-0 scale-50'
                    : 'opacity-100 scale-100',
                )}
              />
            </div>
          </Tooltip>
        </div>
        <div
          className={cn(
            'bg-transparent w-full p-0 font-mono select-text pointer-events-auto overflow-auto no-scrollbar max-w-[650px]',
            (!isPreviewMode || isMermaid) && 'mt-8',
            codeLines.length > 20 && 'max-h-[500px]',
          )}
        >
          {mermaidError && (
            <div
              contentEditable="false"
              className="border-b color-border-default p-2"
            >
              <p className="color-text-danger text-helper-text-sm">
                {mermaidError}
              </p>
            </div>
          )}
          <div
            className={cn(
              'flex flex-row gap-3',
              showMermaidPreview && 'hidden',
              !wordWrap && 'w-max',
            )}
          >
            {lineNumbers && (
              <div className="flex-none text-right">
                {codeLines.map((_, i) => (
                  <div
                    key={i}
                    className="leading-5 h-5 text-helper-text-sm font-mono color-text-secondary opacity-50"
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
            )}
            <NodeViewContent
              ref={codeRef}
              as="div"
              className={cn(
                'leading-5 font-mono pl-4 flex-1',
                node.textContent.length === 0 && 'min-h-[20px]',
              )}
              onFocus={handleFocus}
            />
          </div>
          {isMermaid && showMermaidPreview && (
            <div
              ref={mermaidContainerRef}
              className="w-full px-4 py-2 flex items-center justify-center"
              dangerouslySetInnerHTML={{
                __html: mermaidSvg || '',
              }}
            />
          )}
        </div>
      </pre>
    </NodeViewWrapper>
  );
}
