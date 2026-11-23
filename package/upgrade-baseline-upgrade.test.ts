import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { toUint8Array } from 'js-base64';
import {
  destroyTracked,
  makeEditor,
  track,
} from './extensions/caret-marks/test-helpers';
import { createHeadlessEditorRuntime } from './hooks/use-headless-editor';
import { handleMarkdownContent } from './extensions/mardown-paste-handler';

const readFixture = (name: string) =>
  fs
    .readFileSync(path.resolve(__dirname, '__fixtures__/upgrade', name), 'utf8')
    .trim();

const TEMPLATE_TABLE_HTML =
  '<table><tbody>' +
  '<tr><th colspan="2"><p>Weekly plan</p></th></tr>' +
  '<tr><td><p>Task</p></td><td><p>Deadline</p></td></tr>' +
  '<tr><td><p>Write spec</p></td><td><p>DD.MM.YYYY</p></td></tr>' +
  '</tbody></table>';

const NESTED_LIST_HTML =
  '<ul><li><p><span style="font-family: Georgia; font-size: 18px; color: #d93025">Styled parent</span></p>' +
  '<ul><li><p><strong>Bold child</strong></p></li>' +
  '<li><p><span style="font-family: Courier New">Mono child</span></p></li></ul></li>' +
  '<li><p>Second parent</p></li></ul>';

const MARKDOWN = [
  '# Pasted title',
  '',
  'Some **bold** and *italic* text with a [link](https://example.com).',
  '',
  '- one',
  '  - nested',
  '- [x] done',
  '',
  '1. first',
  '2. second',
  '',
  '| Case | Result |',
  '|---|---|',
  '| A1 | Pass |',
  '',
  '> quoted',
  '',
  '```js',
  'const a = 1;',
  '```',
].join('\n');

const openFixture = async (schemaVersion: number) => {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, toUint8Array(readFixture(`v${schemaVersion}-doc.b64`)));
  let writes = 0;
  ydoc.on('update', () => {
    writes += 1;
  });

  const editor = track(makeEditor(schemaVersion, null, { ydoc }));
  await Promise.resolve();
  return { json: editor.getJSON(), writes };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Headless editors mint fresh heading and block ids each run.
const maskIds = (value: unknown): unknown => {
  if (typeof value === 'string') return UUID.test(value) ? '<uuid>' : value;
  if (Array.isArray(value)) return value.map(maskIds);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, maskIds(entry)]),
    );
  }
  return value;
};

const headless = (schemaVersion: number) =>
  track(createHeadlessEditorRuntime().getEditor({ schemaVersion }).editor);

const templateTableJSON = (schemaVersion: number) => {
  const editor = headless(schemaVersion);
  editor.commands.setContent(TEMPLATE_TABLE_HTML);
  return maskIds(editor.getJSON());
};

const nestedListJSON = (schemaVersion: number) => {
  const editor = headless(schemaVersion);
  editor.commands.setContent(NESTED_LIST_HTML);
  return maskIds(editor.getJSON());
};

const markdownJSON = async (schemaVersion: number) => {
  const editor = headless(schemaVersion);
  await handleMarkdownContent(editor.view, MARKDOWN);
  return maskIds(editor.getJSON());
};

// Inline snapshots are per call site, so each schema spells out its own
// expectations instead of sharing a describe.each body.
describe('schema v1', () => {
  afterEach(destroyTracked);

  it('opens a 3.11 document unchanged', async () => {
    expect(await openFixture(1)).toMatchInlineSnapshot(`
      {
        "json": {
          "attrs": {
            "dir": "auto",
          },
          "content": [
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "caretMarks": null,
                    "data-toc-id": "dcf915b8-d6b1-434c-b145-8e0fe4db9078",
                    "dir": "auto",
                    "id": "dcf915b8-d6b1-434c-b145-8e0fe4db9078",
                    "isCollapsed": false,
                    "level": 1,
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                    "textAlign": null,
                  },
                  "content": [
                    {
                      "text": "Upgrade fixture",
                      "type": "text",
                    },
                  ],
                  "type": "heading",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "caretMarks": null,
                    "class": null,
                    "dir": "auto",
                    "fontFamily": null,
                    "fontSize": null,
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                    "textAlign": null,
                  },
                  "content": [
                    {
                      "text": "Plain ",
                      "type": "text",
                    },
                    {
                      "marks": [
                        {
                          "type": "bold",
                        },
                      ],
                      "text": "bold",
                      "type": "text",
                    },
                    {
                      "text": " and ",
                      "type": "text",
                    },
                    {
                      "marks": [
                        {
                          "attrs": {
                            "color": "#d93025",
                            "data-original-color": null,
                            "fontFamily": "Georgia",
                            "fontSize": "18px",
                          },
                          "type": "textStyle",
                        },
                      ],
                      "text": "styled",
                      "type": "text",
                    },
                    {
                      "text": " text.",
                      "type": "text",
                    },
                  ],
                  "type": "paragraph",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                    "tight": true,
                  },
                  "content": [
                    {
                      "attrs": {
                        "dir": "auto",
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                      },
                      "content": [
                        {
                          "attrs": {
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "Parent item",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                        {
                          "attrs": {
                            "dir": "auto",
                            "tight": true,
                          },
                          "content": [
                            {
                              "attrs": {
                                "dir": "auto",
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                              },
                              "content": [
                                {
                                  "attrs": {
                                    "caretMarks": null,
                                    "class": null,
                                    "dir": "auto",
                                    "fontFamily": null,
                                    "fontSize": null,
                                    "lineHeight": "138%",
                                    "spaceAfter": null,
                                    "spaceBefore": null,
                                    "textAlign": null,
                                  },
                                  "content": [
                                    {
                                      "text": "Child one",
                                      "type": "text",
                                    },
                                  ],
                                  "type": "paragraph",
                                },
                              ],
                              "type": "listItem",
                            },
                            {
                              "attrs": {
                                "dir": "auto",
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                              },
                              "content": [
                                {
                                  "attrs": {
                                    "caretMarks": null,
                                    "class": null,
                                    "dir": "auto",
                                    "fontFamily": null,
                                    "fontSize": null,
                                    "lineHeight": "138%",
                                    "spaceAfter": null,
                                    "spaceBefore": null,
                                    "textAlign": null,
                                  },
                                  "content": [
                                    {
                                      "text": "Child two",
                                      "type": "text",
                                    },
                                  ],
                                  "type": "paragraph",
                                },
                              ],
                              "type": "listItem",
                            },
                          ],
                          "type": "bulletList",
                        },
                      ],
                      "type": "listItem",
                    },
                    {
                      "attrs": {
                        "dir": "auto",
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                      },
                      "content": [
                        {
                          "attrs": {
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "Second parent",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "listItem",
                    },
                  ],
                  "type": "bulletList",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "checked": true,
                        "dir": "auto",
                      },
                      "content": [
                        {
                          "attrs": {
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "Done",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "taskItem",
                    },
                    {
                      "attrs": {
                        "checked": false,
                        "dir": "auto",
                      },
                      "content": [
                        {
                          "attrs": {
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "Todo",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "taskItem",
                    },
                  ],
                  "type": "taskList",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                    "start": 1,
                    "tight": true,
                    "type": null,
                  },
                  "content": [
                    {
                      "attrs": {
                        "dir": "auto",
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                      },
                      "content": [
                        {
                          "attrs": {
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "First",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "listItem",
                    },
                    {
                      "attrs": {
                        "dir": "auto",
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                      },
                      "content": [
                        {
                          "attrs": {
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "Second",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "listItem",
                    },
                  ],
                  "type": "orderedList",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "dir": "auto",
                      },
                      "content": [
                        {
                          "attrs": {
                            "colspan": 1,
                            "colwidth": null,
                            "dir": "auto",
                            "rowspan": 1,
                          },
                          "content": [
                            {
                              "attrs": {
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "H1",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "tableHeader",
                        },
                        {
                          "attrs": {
                            "colspan": 1,
                            "colwidth": null,
                            "dir": "auto",
                            "rowspan": 1,
                          },
                          "content": [
                            {
                              "attrs": {
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "H2",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "tableHeader",
                        },
                      ],
                      "type": "tableRow",
                    },
                    {
                      "attrs": {
                        "dir": "auto",
                      },
                      "content": [
                        {
                          "attrs": {
                            "colspan": 1,
                            "colwidth": null,
                            "dir": "auto",
                            "rowspan": 1,
                          },
                          "content": [
                            {
                              "attrs": {
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "A1",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "tableCell",
                        },
                        {
                          "attrs": {
                            "colspan": 1,
                            "colwidth": null,
                            "dir": "auto",
                            "rowspan": 1,
                          },
                          "content": [
                            {
                              "attrs": {
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "A2",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "tableCell",
                        },
                      ],
                      "type": "tableRow",
                    },
                  ],
                  "type": "table",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "alt": "pic",
                    "authTag": null,
                    "backgroundColor": null,
                    "caption": null,
                    "dataAlign": "center",
                    "dataFloat": null,
                    "dir": "auto",
                    "encryptedKey": null,
                    "encryptionKey": null,
                    "height": "auto",
                    "ipfsHash": null,
                    "ipfsUrl": null,
                    "iv": null,
                    "media-type": "img",
                    "mimeType": null,
                    "nonce": null,
                    "privateKey": null,
                    "src": "https://example.com/pic.png",
                    "title": null,
                    "url": null,
                    "version": null,
                    "width": "100%",
                  },
                  "type": "resizableMedia",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "code": "",
                    "dir": "auto",
                    "language": "js",
                    "lineNumbers": true,
                    "shouldFocus": false,
                    "tabSize": 2,
                    "wordWrap": false,
                  },
                  "content": [
                    {
                      "text": "const a = 1;",
                      "type": "text",
                    },
                  ],
                  "type": "codeBlock",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "content": [
                        {
                          "text": "Quoted text",
                          "type": "text",
                        },
                      ],
                      "type": "paragraph",
                    },
                  ],
                  "type": "blockquote",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "caretMarks": null,
                    "class": "trailing-node",
                    "dir": "auto",
                    "fontFamily": null,
                    "fontSize": null,
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                    "textAlign": null,
                  },
                  "type": "paragraph",
                },
              ],
              "type": "dBlock",
            },
          ],
          "type": "doc",
        },
        "writes": 0,
      }
    `);
  });

  describe('headless conversion is stable', () => {
    it('a template table', () => {
      expect(templateTableJSON(1)).toMatchInlineSnapshot(`
        {
          "attrs": {
            "dir": "auto",
          },
          "content": [
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "dir": "auto",
                      },
                      "content": [
                        {
                          "attrs": {
                            "colspan": 2,
                            "colwidth": null,
                            "dir": "auto",
                            "rowspan": 1,
                          },
                          "content": [
                            {
                              "attrs": {
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "Weekly plan",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "tableHeader",
                        },
                      ],
                      "type": "tableRow",
                    },
                    {
                      "attrs": {
                        "dir": "auto",
                      },
                      "content": [
                        {
                          "attrs": {
                            "colspan": 1,
                            "colwidth": null,
                            "dir": "auto",
                            "rowspan": 1,
                          },
                          "content": [
                            {
                              "attrs": {
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "Task",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "tableCell",
                        },
                        {
                          "attrs": {
                            "colspan": 1,
                            "colwidth": null,
                            "dir": "auto",
                            "rowspan": 1,
                          },
                          "content": [
                            {
                              "attrs": {
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "Deadline",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "tableCell",
                        },
                      ],
                      "type": "tableRow",
                    },
                    {
                      "attrs": {
                        "dir": "auto",
                      },
                      "content": [
                        {
                          "attrs": {
                            "colspan": 1,
                            "colwidth": null,
                            "dir": "auto",
                            "rowspan": 1,
                          },
                          "content": [
                            {
                              "attrs": {
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "Write spec",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "tableCell",
                        },
                        {
                          "attrs": {
                            "colspan": 1,
                            "colwidth": null,
                            "dir": "auto",
                            "rowspan": 1,
                          },
                          "content": [
                            {
                              "attrs": {
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "DD.MM.YYYY",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "tableCell",
                        },
                      ],
                      "type": "tableRow",
                    },
                  ],
                  "type": "table",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "caretMarks": null,
                    "class": "trailing-node",
                    "dir": "auto",
                    "fontFamily": null,
                    "fontSize": null,
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                    "textAlign": null,
                  },
                  "type": "paragraph",
                },
              ],
              "type": "dBlock",
            },
          ],
          "type": "doc",
        }
      `);
    });

    it('a nested list with fonts', () => {
      expect(nestedListJSON(1)).toMatchInlineSnapshot(`
        {
          "attrs": {
            "dir": "auto",
          },
          "content": [
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                    "tight": false,
                  },
                  "content": [
                    {
                      "attrs": {
                        "dir": "auto",
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                      },
                      "content": [
                        {
                          "attrs": {
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "marks": [
                                {
                                  "attrs": {
                                    "color": "#d93025",
                                    "data-original-color": null,
                                    "fontFamily": "Georgia",
                                    "fontSize": "18px",
                                  },
                                  "type": "textStyle",
                                },
                              ],
                              "text": "Styled parent",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                        {
                          "attrs": {
                            "dir": "auto",
                            "tight": false,
                          },
                          "content": [
                            {
                              "attrs": {
                                "dir": "auto",
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                              },
                              "content": [
                                {
                                  "attrs": {
                                    "caretMarks": null,
                                    "class": null,
                                    "dir": "auto",
                                    "fontFamily": null,
                                    "fontSize": null,
                                    "lineHeight": "138%",
                                    "spaceAfter": null,
                                    "spaceBefore": null,
                                    "textAlign": null,
                                  },
                                  "content": [
                                    {
                                      "marks": [
                                        {
                                          "type": "bold",
                                        },
                                      ],
                                      "text": "Bold child",
                                      "type": "text",
                                    },
                                  ],
                                  "type": "paragraph",
                                },
                              ],
                              "type": "listItem",
                            },
                            {
                              "attrs": {
                                "dir": "auto",
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                              },
                              "content": [
                                {
                                  "attrs": {
                                    "caretMarks": null,
                                    "class": null,
                                    "dir": "auto",
                                    "fontFamily": null,
                                    "fontSize": null,
                                    "lineHeight": "138%",
                                    "spaceAfter": null,
                                    "spaceBefore": null,
                                    "textAlign": null,
                                  },
                                  "content": [
                                    {
                                      "marks": [
                                        {
                                          "attrs": {
                                            "color": "",
                                            "data-original-color": null,
                                            "fontFamily": "Courier New",
                                            "fontSize": null,
                                          },
                                          "type": "textStyle",
                                        },
                                      ],
                                      "text": "Mono child",
                                      "type": "text",
                                    },
                                  ],
                                  "type": "paragraph",
                                },
                              ],
                              "type": "listItem",
                            },
                          ],
                          "type": "bulletList",
                        },
                      ],
                      "type": "listItem",
                    },
                    {
                      "attrs": {
                        "dir": "auto",
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                      },
                      "content": [
                        {
                          "attrs": {
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "Second parent",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "listItem",
                    },
                  ],
                  "type": "bulletList",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "caretMarks": null,
                    "class": "trailing-node",
                    "dir": "auto",
                    "fontFamily": null,
                    "fontSize": null,
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                    "textAlign": null,
                  },
                  "type": "paragraph",
                },
              ],
              "type": "dBlock",
            },
          ],
          "type": "doc",
        }
      `);
    });

    it('a markdown-pasted doc', async () => {
      expect(await markdownJSON(1)).toMatchInlineSnapshot(`
        {
          "attrs": {
            "dir": "auto",
          },
          "content": [
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "caretMarks": null,
                    "class": null,
                    "dir": "auto",
                    "fontFamily": null,
                    "fontSize": null,
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                    "textAlign": null,
                  },
                  "type": "paragraph",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "caretMarks": null,
                    "data-toc-id": "<uuid>",
                    "dir": "auto",
                    "id": "<uuid>",
                    "isCollapsed": false,
                    "level": 1,
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                    "textAlign": null,
                  },
                  "content": [
                    {
                      "text": "Pasted title",
                      "type": "text",
                    },
                  ],
                  "type": "heading",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "caretMarks": null,
                    "class": null,
                    "dir": "auto",
                    "fontFamily": null,
                    "fontSize": null,
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                    "textAlign": null,
                  },
                  "content": [
                    {
                      "text": "Some ",
                      "type": "text",
                    },
                    {
                      "marks": [
                        {
                          "type": "bold",
                        },
                      ],
                      "text": "bold",
                      "type": "text",
                    },
                    {
                      "text": " and ",
                      "type": "text",
                    },
                    {
                      "marks": [
                        {
                          "type": "italic",
                        },
                      ],
                      "text": "italic",
                      "type": "text",
                    },
                    {
                      "text": " text with a ",
                      "type": "text",
                    },
                    {
                      "marks": [
                        {
                          "attrs": {
                            "class": "custom-text-link",
                            "href": "https://example.com",
                            "rel": "noopener noreferrer",
                            "target": "_blank",
                            "title": null,
                          },
                          "type": "link",
                        },
                      ],
                      "text": "link",
                      "type": "text",
                    },
                    {
                      "text": ".",
                      "type": "text",
                    },
                  ],
                  "type": "paragraph",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "checked": false,
                        "dir": "auto",
                      },
                      "content": [
                        {
                          "attrs": {
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "type": "paragraph",
                        },
                      ],
                      "type": "taskItem",
                    },
                  ],
                  "type": "taskList",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                    "start": 1,
                    "tight": true,
                    "type": null,
                  },
                  "content": [
                    {
                      "attrs": {
                        "dir": "auto",
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                      },
                      "content": [
                        {
                          "attrs": {
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "one",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                        {
                          "attrs": {
                            "dir": "auto",
                            "tight": true,
                          },
                          "content": [
                            {
                              "attrs": {
                                "dir": "auto",
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                              },
                              "content": [
                                {
                                  "attrs": {
                                    "caretMarks": null,
                                    "class": null,
                                    "dir": "auto",
                                    "fontFamily": null,
                                    "fontSize": null,
                                    "lineHeight": "138%",
                                    "spaceAfter": null,
                                    "spaceBefore": null,
                                    "textAlign": null,
                                  },
                                  "content": [
                                    {
                                      "text": "nested",
                                      "type": "text",
                                    },
                                  ],
                                  "type": "paragraph",
                                },
                              ],
                              "type": "listItem",
                            },
                          ],
                          "type": "bulletList",
                        },
                      ],
                      "type": "listItem",
                    },
                  ],
                  "type": "orderedList",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "checked": true,
                        "dir": "auto",
                      },
                      "content": [
                        {
                          "attrs": {
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "done",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "taskItem",
                    },
                  ],
                  "type": "taskList",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                    "start": 1,
                    "tight": true,
                    "type": null,
                  },
                  "content": [
                    {
                      "attrs": {
                        "dir": "auto",
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                      },
                      "content": [
                        {
                          "attrs": {
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "first",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "listItem",
                    },
                    {
                      "attrs": {
                        "dir": "auto",
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                      },
                      "content": [
                        {
                          "attrs": {
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "second",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "listItem",
                    },
                  ],
                  "type": "orderedList",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "dir": "auto",
                      },
                      "content": [
                        {
                          "attrs": {
                            "colspan": 1,
                            "colwidth": null,
                            "dir": "auto",
                            "rowspan": 1,
                          },
                          "content": [
                            {
                              "attrs": {
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "Case",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "tableHeader",
                        },
                        {
                          "attrs": {
                            "colspan": 1,
                            "colwidth": null,
                            "dir": "auto",
                            "rowspan": 1,
                          },
                          "content": [
                            {
                              "attrs": {
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "Result",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "tableHeader",
                        },
                      ],
                      "type": "tableRow",
                    },
                    {
                      "attrs": {
                        "dir": "auto",
                      },
                      "content": [
                        {
                          "attrs": {
                            "colspan": 1,
                            "colwidth": null,
                            "dir": "auto",
                            "rowspan": 1,
                          },
                          "content": [
                            {
                              "attrs": {
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "A1",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "tableCell",
                        },
                        {
                          "attrs": {
                            "colspan": 1,
                            "colwidth": null,
                            "dir": "auto",
                            "rowspan": 1,
                          },
                          "content": [
                            {
                              "attrs": {
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "Pass",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "tableCell",
                        },
                      ],
                      "type": "tableRow",
                    },
                  ],
                  "type": "table",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "content": [
                        {
                          "text": "quoted",
                          "type": "text",
                        },
                      ],
                      "type": "paragraph",
                    },
                  ],
                  "type": "blockquote",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "code": "const a = 1;
        ",
                    "dir": "auto",
                    "language": "js",
                    "lineNumbers": true,
                    "shouldFocus": false,
                    "tabSize": 2,
                    "wordWrap": false,
                  },
                  "content": [
                    {
                      "text": "const a = 1;
        ",
                      "type": "text",
                    },
                  ],
                  "type": "codeBlock",
                },
              ],
              "type": "dBlock",
            },
            {
              "attrs": {
                "dir": "auto",
                "isCorrupted": false,
              },
              "content": [
                {
                  "attrs": {
                    "caretMarks": null,
                    "class": "trailing-node",
                    "dir": "auto",
                    "fontFamily": null,
                    "fontSize": null,
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                    "textAlign": null,
                  },
                  "type": "paragraph",
                },
              ],
              "type": "dBlock",
            },
          ],
          "type": "doc",
        }
      `);
    });
  });
});

describe('schema v2', () => {
  afterEach(destroyTracked);

  it('opens a 3.11 document unchanged', async () => {
    expect(await openFixture(2)).toMatchInlineSnapshot(`
      {
        "json": {
          "attrs": {
            "dir": "auto",
          },
          "content": [
            {
              "attrs": {
                "blockId": "a2d689d1-e755-4ba7-a1f8-db73160026b3",
                "caretMarks": null,
                "data-toc-id": "6f4016fa-ccf8-40ce-9db2-3189fc0e6781",
                "dir": "auto",
                "id": "6f4016fa-ccf8-40ce-9db2-3189fc0e6781",
                "isCollapsed": false,
                "level": 1,
                "lineHeight": "138%",
                "spaceAfter": null,
                "spaceBefore": null,
                "textAlign": null,
              },
              "content": [
                {
                  "text": "Upgrade fixture",
                  "type": "text",
                },
              ],
              "type": "heading",
            },
            {
              "attrs": {
                "blockId": "fed6ae01-c2f1-4e22-8e61-acc1dc1c46f1",
                "caretMarks": null,
                "class": null,
                "dir": "auto",
                "fontFamily": null,
                "fontSize": null,
                "lineHeight": "138%",
                "spaceAfter": null,
                "spaceBefore": null,
                "textAlign": null,
              },
              "content": [
                {
                  "text": "Plain ",
                  "type": "text",
                },
                {
                  "marks": [
                    {
                      "type": "bold",
                    },
                  ],
                  "text": "bold",
                  "type": "text",
                },
                {
                  "text": " and ",
                  "type": "text",
                },
                {
                  "marks": [
                    {
                      "attrs": {
                        "color": "#d93025",
                        "data-original-color": null,
                        "fontFamily": "Georgia",
                        "fontSize": "18px",
                      },
                      "type": "textStyle",
                    },
                  ],
                  "text": "styled",
                  "type": "text",
                },
                {
                  "text": " text.",
                  "type": "text",
                },
              ],
              "type": "paragraph",
            },
            {
              "attrs": {
                "blockId": "f3c92241-6d45-4814-8818-441944647591",
                "dir": "auto",
                "tight": true,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                  },
                  "content": [
                    {
                      "attrs": {
                        "blockId": null,
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "content": [
                        {
                          "text": "Parent item",
                          "type": "text",
                        },
                      ],
                      "type": "paragraph",
                    },
                    {
                      "attrs": {
                        "blockId": null,
                        "dir": "auto",
                        "tight": true,
                      },
                      "content": [
                        {
                          "attrs": {
                            "dir": "auto",
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                          },
                          "content": [
                            {
                              "attrs": {
                                "blockId": null,
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "Child one",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "listItem",
                        },
                        {
                          "attrs": {
                            "dir": "auto",
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                          },
                          "content": [
                            {
                              "attrs": {
                                "blockId": null,
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "Child two",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "listItem",
                        },
                      ],
                      "type": "bulletList",
                    },
                  ],
                  "type": "listItem",
                },
                {
                  "attrs": {
                    "dir": "auto",
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                  },
                  "content": [
                    {
                      "attrs": {
                        "blockId": null,
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "content": [
                        {
                          "text": "Second parent",
                          "type": "text",
                        },
                      ],
                      "type": "paragraph",
                    },
                  ],
                  "type": "listItem",
                },
              ],
              "type": "bulletList",
            },
            {
              "attrs": {
                "blockId": "7514714e-8584-4a06-8ca3-badf39c6d371",
                "dir": "auto",
              },
              "content": [
                {
                  "attrs": {
                    "checked": true,
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "blockId": null,
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "content": [
                        {
                          "text": "Done",
                          "type": "text",
                        },
                      ],
                      "type": "paragraph",
                    },
                  ],
                  "type": "taskItem",
                },
                {
                  "attrs": {
                    "checked": false,
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "blockId": null,
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "content": [
                        {
                          "text": "Todo",
                          "type": "text",
                        },
                      ],
                      "type": "paragraph",
                    },
                  ],
                  "type": "taskItem",
                },
              ],
              "type": "taskList",
            },
            {
              "attrs": {
                "blockId": "9654d742-7233-482c-8450-c7a01eeec82b",
                "dir": "auto",
                "start": 1,
                "tight": true,
                "type": null,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                  },
                  "content": [
                    {
                      "attrs": {
                        "blockId": null,
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "content": [
                        {
                          "text": "First",
                          "type": "text",
                        },
                      ],
                      "type": "paragraph",
                    },
                  ],
                  "type": "listItem",
                },
                {
                  "attrs": {
                    "dir": "auto",
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                  },
                  "content": [
                    {
                      "attrs": {
                        "blockId": null,
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "content": [
                        {
                          "text": "Second",
                          "type": "text",
                        },
                      ],
                      "type": "paragraph",
                    },
                  ],
                  "type": "listItem",
                },
              ],
              "type": "orderedList",
            },
            {
              "attrs": {
                "blockId": "337c44ca-474a-4633-a709-ca2e485a7d91",
                "dir": "auto",
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "colspan": 1,
                        "colwidth": null,
                        "dir": "auto",
                        "rowspan": 1,
                      },
                      "content": [
                        {
                          "attrs": {
                            "blockId": null,
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "H1",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "tableHeader",
                    },
                    {
                      "attrs": {
                        "colspan": 1,
                        "colwidth": null,
                        "dir": "auto",
                        "rowspan": 1,
                      },
                      "content": [
                        {
                          "attrs": {
                            "blockId": null,
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "H2",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "tableHeader",
                    },
                  ],
                  "type": "tableRow",
                },
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "colspan": 1,
                        "colwidth": null,
                        "dir": "auto",
                        "rowspan": 1,
                      },
                      "content": [
                        {
                          "attrs": {
                            "blockId": null,
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "A1",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "tableCell",
                    },
                    {
                      "attrs": {
                        "colspan": 1,
                        "colwidth": null,
                        "dir": "auto",
                        "rowspan": 1,
                      },
                      "content": [
                        {
                          "attrs": {
                            "blockId": null,
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "A2",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "tableCell",
                    },
                  ],
                  "type": "tableRow",
                },
              ],
              "type": "table",
            },
            {
              "attrs": {
                "alt": "pic",
                "authTag": null,
                "backgroundColor": null,
                "blockId": "ef0d96d6-cbc3-4d05-bd26-c53a604adbe9",
                "caption": null,
                "dataAlign": "center",
                "dataFloat": null,
                "dir": "auto",
                "encryptedKey": null,
                "encryptionKey": null,
                "height": "auto",
                "ipfsHash": null,
                "ipfsUrl": null,
                "iv": null,
                "media-type": "img",
                "mimeType": null,
                "nonce": null,
                "privateKey": null,
                "src": "https://example.com/pic.png",
                "title": null,
                "url": null,
                "version": null,
                "width": "100%",
              },
              "type": "resizableMedia",
            },
            {
              "attrs": {
                "blockId": "c9997526-f679-4155-a7dd-bd6d22c6bd92",
                "code": "",
                "dir": "auto",
                "language": "js",
                "lineNumbers": true,
                "shouldFocus": false,
                "tabSize": 2,
                "wordWrap": false,
              },
              "content": [
                {
                  "text": "const a = 1;",
                  "type": "text",
                },
              ],
              "type": "codeBlock",
            },
            {
              "attrs": {
                "blockId": "a14a5360-430b-4412-bed1-cda766f54672",
                "dir": "auto",
              },
              "content": [
                {
                  "attrs": {
                    "blockId": null,
                    "caretMarks": null,
                    "class": null,
                    "dir": "auto",
                    "fontFamily": null,
                    "fontSize": null,
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                    "textAlign": null,
                  },
                  "content": [
                    {
                      "text": "Quoted text",
                      "type": "text",
                    },
                  ],
                  "type": "paragraph",
                },
              ],
              "type": "blockquote",
            },
            {
              "attrs": {
                "blockId": "cfbe70aa-2fdb-44c2-8fa1-aba07daea7f3",
                "caretMarks": null,
                "class": null,
                "dir": "auto",
                "fontFamily": null,
                "fontSize": null,
                "lineHeight": "138%",
                "spaceAfter": null,
                "spaceBefore": null,
                "textAlign": null,
              },
              "type": "paragraph",
            },
          ],
          "type": "doc",
        },
        "writes": 0,
      }
    `);
  });

  describe('headless conversion is stable', () => {
    it('a template table', () => {
      expect(templateTableJSON(2)).toMatchInlineSnapshot(`
        {
          "attrs": {
            "dir": "auto",
          },
          "content": [
            {
              "attrs": {
                "blockId": "<uuid>",
                "dir": "auto",
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "colspan": 2,
                        "colwidth": null,
                        "dir": "auto",
                        "rowspan": 1,
                      },
                      "content": [
                        {
                          "attrs": {
                            "blockId": null,
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "Weekly plan",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "tableHeader",
                    },
                  ],
                  "type": "tableRow",
                },
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "colspan": 1,
                        "colwidth": null,
                        "dir": "auto",
                        "rowspan": 1,
                      },
                      "content": [
                        {
                          "attrs": {
                            "blockId": null,
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "Task",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "tableCell",
                    },
                    {
                      "attrs": {
                        "colspan": 1,
                        "colwidth": null,
                        "dir": "auto",
                        "rowspan": 1,
                      },
                      "content": [
                        {
                          "attrs": {
                            "blockId": null,
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "Deadline",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "tableCell",
                    },
                  ],
                  "type": "tableRow",
                },
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "colspan": 1,
                        "colwidth": null,
                        "dir": "auto",
                        "rowspan": 1,
                      },
                      "content": [
                        {
                          "attrs": {
                            "blockId": null,
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "Write spec",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "tableCell",
                    },
                    {
                      "attrs": {
                        "colspan": 1,
                        "colwidth": null,
                        "dir": "auto",
                        "rowspan": 1,
                      },
                      "content": [
                        {
                          "attrs": {
                            "blockId": null,
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "DD.MM.YYYY",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "tableCell",
                    },
                  ],
                  "type": "tableRow",
                },
              ],
              "type": "table",
            },
            {
              "attrs": {
                "blockId": "<uuid>",
                "caretMarks": null,
                "class": null,
                "dir": "auto",
                "fontFamily": null,
                "fontSize": null,
                "lineHeight": "138%",
                "spaceAfter": null,
                "spaceBefore": null,
                "textAlign": null,
              },
              "type": "paragraph",
            },
          ],
          "type": "doc",
        }
      `);
    });

    it('a nested list with fonts', () => {
      expect(nestedListJSON(2)).toMatchInlineSnapshot(`
        {
          "attrs": {
            "dir": "auto",
          },
          "content": [
            {
              "attrs": {
                "blockId": "<uuid>",
                "dir": "auto",
                "tight": false,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                  },
                  "content": [
                    {
                      "attrs": {
                        "blockId": null,
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "content": [
                        {
                          "marks": [
                            {
                              "attrs": {
                                "color": "#d93025",
                                "data-original-color": null,
                                "fontFamily": "Georgia",
                                "fontSize": "18px",
                              },
                              "type": "textStyle",
                            },
                          ],
                          "text": "Styled parent",
                          "type": "text",
                        },
                      ],
                      "type": "paragraph",
                    },
                    {
                      "attrs": {
                        "blockId": null,
                        "dir": "auto",
                        "tight": false,
                      },
                      "content": [
                        {
                          "attrs": {
                            "dir": "auto",
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                          },
                          "content": [
                            {
                              "attrs": {
                                "blockId": null,
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "marks": [
                                    {
                                      "type": "bold",
                                    },
                                  ],
                                  "text": "Bold child",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "listItem",
                        },
                        {
                          "attrs": {
                            "dir": "auto",
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                          },
                          "content": [
                            {
                              "attrs": {
                                "blockId": null,
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "marks": [
                                    {
                                      "attrs": {
                                        "color": "",
                                        "data-original-color": null,
                                        "fontFamily": "Courier New",
                                        "fontSize": null,
                                      },
                                      "type": "textStyle",
                                    },
                                  ],
                                  "text": "Mono child",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "listItem",
                        },
                      ],
                      "type": "bulletList",
                    },
                  ],
                  "type": "listItem",
                },
                {
                  "attrs": {
                    "dir": "auto",
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                  },
                  "content": [
                    {
                      "attrs": {
                        "blockId": null,
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "content": [
                        {
                          "text": "Second parent",
                          "type": "text",
                        },
                      ],
                      "type": "paragraph",
                    },
                  ],
                  "type": "listItem",
                },
              ],
              "type": "bulletList",
            },
            {
              "attrs": {
                "blockId": "<uuid>",
                "caretMarks": null,
                "class": null,
                "dir": "auto",
                "fontFamily": null,
                "fontSize": null,
                "lineHeight": "138%",
                "spaceAfter": null,
                "spaceBefore": null,
                "textAlign": null,
              },
              "type": "paragraph",
            },
          ],
          "type": "doc",
        }
      `);
    });

    it('a markdown-pasted doc', async () => {
      expect(await markdownJSON(2)).toMatchInlineSnapshot(`
        {
          "attrs": {
            "dir": "auto",
          },
          "content": [
            {
              "attrs": {
                "blockId": "<uuid>",
                "caretMarks": null,
                "class": null,
                "dir": "auto",
                "fontFamily": null,
                "fontSize": null,
                "lineHeight": "138%",
                "spaceAfter": null,
                "spaceBefore": null,
                "textAlign": null,
              },
              "type": "paragraph",
            },
            {
              "attrs": {
                "blockId": "<uuid>",
                "caretMarks": null,
                "data-toc-id": "<uuid>",
                "dir": "auto",
                "id": "<uuid>",
                "isCollapsed": false,
                "level": 1,
                "lineHeight": "138%",
                "spaceAfter": null,
                "spaceBefore": null,
                "textAlign": null,
              },
              "content": [
                {
                  "text": "Pasted title",
                  "type": "text",
                },
              ],
              "type": "heading",
            },
            {
              "attrs": {
                "blockId": "<uuid>",
                "caretMarks": null,
                "class": null,
                "dir": "auto",
                "fontFamily": null,
                "fontSize": null,
                "lineHeight": "138%",
                "spaceAfter": null,
                "spaceBefore": null,
                "textAlign": null,
              },
              "content": [
                {
                  "text": "Some ",
                  "type": "text",
                },
                {
                  "marks": [
                    {
                      "type": "bold",
                    },
                  ],
                  "text": "bold",
                  "type": "text",
                },
                {
                  "text": " and ",
                  "type": "text",
                },
                {
                  "marks": [
                    {
                      "type": "italic",
                    },
                  ],
                  "text": "italic",
                  "type": "text",
                },
                {
                  "text": " text with a ",
                  "type": "text",
                },
                {
                  "marks": [
                    {
                      "attrs": {
                        "class": "custom-text-link",
                        "href": "https://example.com",
                        "rel": "noopener noreferrer",
                        "target": "_blank",
                        "title": null,
                      },
                      "type": "link",
                    },
                  ],
                  "text": "link",
                  "type": "text",
                },
                {
                  "text": ".",
                  "type": "text",
                },
              ],
              "type": "paragraph",
            },
            {
              "attrs": {
                "blockId": "<uuid>",
                "dir": "auto",
              },
              "content": [
                {
                  "attrs": {
                    "checked": false,
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "blockId": null,
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "type": "paragraph",
                    },
                  ],
                  "type": "taskItem",
                },
              ],
              "type": "taskList",
            },
            {
              "attrs": {
                "blockId": "<uuid>",
                "dir": "auto",
                "start": 1,
                "tight": true,
                "type": null,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                  },
                  "content": [
                    {
                      "attrs": {
                        "blockId": null,
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "content": [
                        {
                          "text": "one",
                          "type": "text",
                        },
                      ],
                      "type": "paragraph",
                    },
                    {
                      "attrs": {
                        "blockId": null,
                        "dir": "auto",
                        "tight": true,
                      },
                      "content": [
                        {
                          "attrs": {
                            "dir": "auto",
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                          },
                          "content": [
                            {
                              "attrs": {
                                "blockId": null,
                                "caretMarks": null,
                                "class": null,
                                "dir": "auto",
                                "fontFamily": null,
                                "fontSize": null,
                                "lineHeight": "138%",
                                "spaceAfter": null,
                                "spaceBefore": null,
                                "textAlign": null,
                              },
                              "content": [
                                {
                                  "text": "nested",
                                  "type": "text",
                                },
                              ],
                              "type": "paragraph",
                            },
                          ],
                          "type": "listItem",
                        },
                      ],
                      "type": "bulletList",
                    },
                  ],
                  "type": "listItem",
                },
              ],
              "type": "orderedList",
            },
            {
              "attrs": {
                "blockId": "<uuid>",
                "dir": "auto",
              },
              "content": [
                {
                  "attrs": {
                    "checked": true,
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "blockId": null,
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "content": [
                        {
                          "text": "done",
                          "type": "text",
                        },
                      ],
                      "type": "paragraph",
                    },
                  ],
                  "type": "taskItem",
                },
              ],
              "type": "taskList",
            },
            {
              "attrs": {
                "blockId": "<uuid>",
                "dir": "auto",
                "start": 1,
                "tight": true,
                "type": null,
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                  },
                  "content": [
                    {
                      "attrs": {
                        "blockId": null,
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "content": [
                        {
                          "text": "first",
                          "type": "text",
                        },
                      ],
                      "type": "paragraph",
                    },
                  ],
                  "type": "listItem",
                },
                {
                  "attrs": {
                    "dir": "auto",
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                  },
                  "content": [
                    {
                      "attrs": {
                        "blockId": null,
                        "caretMarks": null,
                        "class": null,
                        "dir": "auto",
                        "fontFamily": null,
                        "fontSize": null,
                        "lineHeight": "138%",
                        "spaceAfter": null,
                        "spaceBefore": null,
                        "textAlign": null,
                      },
                      "content": [
                        {
                          "text": "second",
                          "type": "text",
                        },
                      ],
                      "type": "paragraph",
                    },
                  ],
                  "type": "listItem",
                },
              ],
              "type": "orderedList",
            },
            {
              "attrs": {
                "blockId": "<uuid>",
                "dir": "auto",
              },
              "content": [
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "colspan": 1,
                        "colwidth": null,
                        "dir": "auto",
                        "rowspan": 1,
                      },
                      "content": [
                        {
                          "attrs": {
                            "blockId": null,
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "Case",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "tableHeader",
                    },
                    {
                      "attrs": {
                        "colspan": 1,
                        "colwidth": null,
                        "dir": "auto",
                        "rowspan": 1,
                      },
                      "content": [
                        {
                          "attrs": {
                            "blockId": null,
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "Result",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "tableHeader",
                    },
                  ],
                  "type": "tableRow",
                },
                {
                  "attrs": {
                    "dir": "auto",
                  },
                  "content": [
                    {
                      "attrs": {
                        "colspan": 1,
                        "colwidth": null,
                        "dir": "auto",
                        "rowspan": 1,
                      },
                      "content": [
                        {
                          "attrs": {
                            "blockId": null,
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "A1",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "tableCell",
                    },
                    {
                      "attrs": {
                        "colspan": 1,
                        "colwidth": null,
                        "dir": "auto",
                        "rowspan": 1,
                      },
                      "content": [
                        {
                          "attrs": {
                            "blockId": null,
                            "caretMarks": null,
                            "class": null,
                            "dir": "auto",
                            "fontFamily": null,
                            "fontSize": null,
                            "lineHeight": "138%",
                            "spaceAfter": null,
                            "spaceBefore": null,
                            "textAlign": null,
                          },
                          "content": [
                            {
                              "text": "Pass",
                              "type": "text",
                            },
                          ],
                          "type": "paragraph",
                        },
                      ],
                      "type": "tableCell",
                    },
                  ],
                  "type": "tableRow",
                },
              ],
              "type": "table",
            },
            {
              "attrs": {
                "blockId": "<uuid>",
                "dir": "auto",
              },
              "content": [
                {
                  "attrs": {
                    "blockId": null,
                    "caretMarks": null,
                    "class": null,
                    "dir": "auto",
                    "fontFamily": null,
                    "fontSize": null,
                    "lineHeight": "138%",
                    "spaceAfter": null,
                    "spaceBefore": null,
                    "textAlign": null,
                  },
                  "content": [
                    {
                      "text": "quoted",
                      "type": "text",
                    },
                  ],
                  "type": "paragraph",
                },
              ],
              "type": "blockquote",
            },
            {
              "attrs": {
                "blockId": "<uuid>",
                "code": "const a = 1;
        ",
                "dir": "auto",
                "language": "js",
                "lineNumbers": true,
                "shouldFocus": false,
                "tabSize": 2,
                "wordWrap": false,
              },
              "content": [
                {
                  "text": "const a = 1;
        ",
                  "type": "text",
                },
              ],
              "type": "codeBlock",
            },
            {
              "attrs": {
                "blockId": "<uuid>",
                "caretMarks": null,
                "class": null,
                "dir": "auto",
                "fontFamily": null,
                "fontSize": null,
                "lineHeight": "138%",
                "spaceAfter": null,
                "spaceBefore": null,
                "textAlign": null,
              },
              "type": "paragraph",
            },
          ],
          "type": "doc",
        }
      `);
    });
  });
});
