import React, { useState } from 'react';
import type { DocumentStyling, PageSetup } from '../../../package/types';
import { handleContentPrint } from '../../../package/utils/handle-print';
import type { PagesPrintBreaks } from '../../../package/extensions/pagination/print';
import { PAGES_FIXTURES } from '../fixtures/pages';
import { buildPagesPrint, computeBreaks, type PagesDebugDeps } from './pages-debug';

type Props = PagesDebugDeps & {
  documentStyling: DocumentStyling;
  onStylingChange: (updates: Partial<DocumentStyling>) => void;
};

const button =
  'px-2 py-1 rounded-md text-xs border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700';

// Pages M0 harness (docs/PAGES_MODE.md §6.1).
export const PagesPanel: React.FC<Props> = (props) => {
  const { documentStyling, onStylingChange } = props;
  const pageSetup: PageSetup = documentStyling.pageSetup ?? {
    mode: 'pageless',
    paper: 'a4',
  };
  const [fixtureId, setFixtureId] = useState(PAGES_FIXTURES[0].id);
  const [debugMarkers, setDebugMarkers] = useState(true);
  const [breaks, setBreaks] = useState<PagesPrintBreaks | null>(null);

  const setPageSetup = (updates: Partial<PageSetup>) =>
    onStylingChange({ pageSetup: { ...pageSetup, ...updates } });

  const loadFixture = () => {
    const fixture = PAGES_FIXTURES.find((f) => f.id === fixtureId);
    props.getEditor()?.commands.setContent(fixture?.html ?? '');
    setBreaks(null);
  };

  const print = async () => {
    const built = await buildPagesPrint(props, debugMarkers);
    if (built) handleContentPrint(built.html, built.options);
  };

  return (
    <div className="mb-6 space-y-2 text-sm text-slate-700 dark:text-slate-300">
      <h4 className="font-medium">Pages (M0)</h4>
      <div className="flex gap-2">
        {(['pageless', 'pages'] as const).map((mode) => (
          <button
            key={mode}
            className={`${button} ${pageSetup.mode === mode ? 'font-semibold' : ''}`}
            onClick={() => setPageSetup({ mode })}
          >
            {mode}
          </button>
        ))}
        <select
          className={button}
          value={pageSetup.paper}
          onChange={(e) =>
            setPageSetup({ paper: e.target.value as PageSetup['paper'] })
          }
        >
          <option value="a4">A4</option>
          <option value="letter">Letter</option>
        </select>
      </div>
      <div className="flex gap-2">
        <select
          className={button}
          value={fixtureId}
          onChange={(e) => setFixtureId(e.target.value)}
        >
          {PAGES_FIXTURES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.id} {f.title}
            </option>
          ))}
        </select>
        <button className={button} onClick={loadFixture}>
          Load
        </button>
      </div>
      <div className="flex gap-2 items-center">
        <button className={button} onClick={() => setBreaks(computeBreaks(props))}>
          Predict
        </button>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={debugMarkers}
            onChange={(e) => setDebugMarkers(e.target.checked)}
          />
          Debug markers
        </label>
        <button className={button} onClick={print}>
          Print
        </button>
      </div>
      {breaks && (
        <ol className="text-xs max-h-48 overflow-y-auto list-decimal pl-5">
          {breaks.pageFirstText.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ol>
      )}
    </div>
  );
};
