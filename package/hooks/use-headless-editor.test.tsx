import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { toUint8Array } from 'js-base64';
import {
  createHeadlessEditorRuntime,
  useHeadlessEditor,
} from './use-headless-editor';
import { getDocSchemaVersion } from '../utils/schema-version';

// v1-shaped template JSON — the app's template-utils source-of-truth shape.
const v1TemplateJSON = {
  type: 'doc',
  content: [
    {
      type: 'dBlock',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Pretend to work' }],
        },
      ],
    },
    {
      type: 'dBlock',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'step one' }],
        },
      ],
    },
  ],
};

// What a stored blob looks like to the rest of the system: apply it to a
// fresh Y.Doc (exactly what the real editor mount does) and inspect.
const decodeBlob = (base64: string) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, toUint8Array(base64));
  const fragment = doc.getXmlFragment('default');
  const topLevelTypes: string[] = [];
  for (let i = 0; i < fragment.length; i++) {
    topLevelTypes.push((fragment.get(i) as Y.XmlElement).nodeName);
  }
  return { doc, topLevelTypes, schemaVersion: getDocSchemaVersion(doc) };
};

const convertWith = (
  options: { schemaVersion?: number } | undefined,
  json: object,
) => {
  const { result } = renderHook(() => useHeadlessEditor());
  const convertor = result.current.getYjsConvertor(options);
  try {
    return convertor.convertJSONContentToYjsEncodedString(json);
  } finally {
    convertor.cleanup();
  }
};

describe('useHeadlessEditor schema-version support (M3 template creation)', () => {
  it('keeps the existing hook API backed by the plain runtime factory', () => {
    const directRuntime = createHeadlessEditorRuntime();
    const { result } = renderHook(() => useHeadlessEditor());

    expect(Object.keys(result.current)).toEqual(Object.keys(directRuntime));
  });

  it('stamps the marker and stores flat content when converting as v2', () => {
    const blob = convertWith({ schemaVersion: 2 }, v1TemplateJSON);
    const { topLevelTypes, schemaVersion } = decodeBlob(blob);

    // The stamp must be inside the blob: at first real mount the doc
    // already has content, so useDocSchemaVersion will never stamp it.
    expect(schemaVersion).toBe(2);
    // dBlock wrappers hoisted away, real blocks at the top level.
    expect(topLevelTypes[0]).toBe('heading');
    expect(topLevelTypes).toContain('paragraph');
    expect(topLevelTypes).not.toContain('dBlock');
  });

  it('preserves the template text through the v2 conversion', () => {
    const blob = convertWith({ schemaVersion: 2 }, v1TemplateJSON);
    const { doc } = decodeBlob(blob);
    const heading = doc.getXmlFragment('default').get(0) as Y.XmlElement;
    // The heading itself must be the top-level node (not buried in a
    // wrapper) and still carry its text after the unwrap.
    expect(heading.nodeName).toBe('heading');
    expect(heading.toString()).toContain('Pretend to work');
  });

  it('keeps the default conversion byte-compatible with v1: wrappers kept, no stamp', () => {
    const blob = convertWith(undefined, v1TemplateJSON);
    const { topLevelTypes, doc } = decodeBlob(blob);

    expect(topLevelTypes[0]).toBe('dBlock');
    // Absence of the marker (not a `1`) is the v1 contract.
    expect(doc.getMap('ddocMeta').get('schemaVersion')).toBeUndefined();
  });

  it('accepts already-flat JSON through the v2 convertor unchanged', () => {
    const flatJSON = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'already flat' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
      ],
    };
    const blob = convertWith({ schemaVersion: 2 }, flatJSON);
    const { topLevelTypes, schemaVersion } = decodeBlob(blob);

    expect(schemaVersion).toBe(2);
    expect(topLevelTypes[0]).toBe('heading');
    expect(topLevelTypes).not.toContain('dBlock');
  });
});
