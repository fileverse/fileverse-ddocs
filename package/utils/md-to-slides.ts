import MarkdownIt from 'markdown-it';
import { Editor } from '@tiptap/react';
import {
  searchForSecureImageNodeAndEmbedImageContent,
  setMarkdownSlideMedia,
  turndownService,
} from '../extensions/mardown-paste-handler';
import TurndownService from 'turndown';
import { IpfsImageFetchPayload } from '../types';
import { getTemporaryEditor } from './helpers';

interface SlideContent {
  type: 'h1' | 'h2' | 'content' | 'image' | 'table';
  content: string;
}

export interface Slides {
  [key: number]: SlideContent[];
}

// Initialize MarkdownIt for parsing Markdown
const markdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
}).enable('table');

export const md = markdownIt;

// Add the same custom rules as in markdown-paste-handler
turndownService.addRule('pageBreak', {
  filter: function (node) {
    return (
      node.nodeName === 'BR' &&
      (node as HTMLElement).getAttribute('data-page-break') === 'true'
    );
  },
  replacement: function () {
    return '\n\n===\n\n';
  },
});

const getPrefix = (node: TurndownService.Node) => {
  const prefix = node.nodeName;
  if (!prefix) return '';

  switch (node.nodeName) {
    case 'H1':
      return '#';
    case 'H2':
      return '##';
    case 'H3':
      return '###';
    default:
      return '';
  }
};

turndownService.addRule('heading', {
  filter: ['h1', 'h2', 'h3'],
  replacement: function (content, node) {
    const prefix = getPrefix(node);
    const replacedContent = content.replace(/\n\n===\n\n/g, '<br>');
    return `${prefix} ${replacedContent}`;
  },
});

// Add custom rules for superscript and subscript
turndownService.addRule('superscript', {
  filter: 'sup',
  replacement: function (content) {
    return `<sup>${content}</sup>`;
  },
});

turndownService.addRule('subscript', {
  filter: 'sub',
  replacement: function (content) {
    return `<sub>${content}</sub>`;
  },
});

// Custom rule for tables
turndownService.addRule('table', {
  filter: 'table',
  replacement: function (_content, node) {
    const table = node as HTMLTableElement;
    const rows = Array.from(table.rows);

    // Process header
    const headers = Array.from(rows[0].cells).map((cell) => {
      return turndownService.turndown(cell.innerHTML).trim();
    });
    const maxColumnWidths = headers.map((header) => header.length);

    // Process body and update maxColumnWidths
    const bodyRows = rows.slice(1).map((row) => {
      return Array.from(row.cells).map((cell, index) => {
        let cellContent = cell.innerHTML.trim();

        // Handle lists
        if (cell.querySelector('ul, ol')) {
          const listType = cell.querySelector('ul') ? 'ul' : 'ol';
          const listItems = Array.from(cell.querySelectorAll('li')).map(
            (li) => li.textContent?.trim() || '',
          );
          cellContent = `<${listType}><li>${listItems.join(
            '</li><li>',
          )}</li></${listType}>`;
        } else {
          cellContent = turndownService.turndown(cellContent);
        }

        maxColumnWidths[index] = Math.max(
          maxColumnWidths[index],
          cellContent.length,
        );
        return cellContent;
      });
    });

    // Create aligned rows
    const createAlignedRow = (row: string[]) => {
      return (
        '| ' +
        row
          .map((cell, index) => {
            const padding = ' '.repeat(
              Math.max(0, maxColumnWidths[index] - cell.length),
            );
            return cell + padding;
          })
          .join(' | ') +
        ' |'
      );
    };

    const headerRow = createAlignedRow(headers);
    const separator =
      '| ' +
      maxColumnWidths.map((width) => '-'.repeat(width)).join(' | ') +
      ' |';
    const bodyRowsFormatted = bodyRows.map((row) => createAlignedRow(row));

    return `\n\n${headerRow}\n${separator}\n${bodyRowsFormatted.join(
      '\n',
    )}\n\n`;
  },
});

turndownService.addRule('taskListItem', {
  filter: (node) => {
    const parent = node.parentElement;
    return (
      node.nodeName === 'LI' && parent?.getAttribute('data-type') === 'taskList'
    );
  },
  replacement: function (content, node) {
    const isChecked =
      (node as HTMLElement).getAttribute('data-checked') === 'true';
    content = content
      .replace(/^\n+/, '') // remove leading newlines
      .replace(/\n+$/, '') // remove trailing newlines
      .replace(/\n/gm, '\n    '); // indent
    return `- [${isChecked ? 'x' : ' '}] ${content}${
      node.nextSibling ? '\n' : ''
    }`;
  },
});

export const convertToMarkdown = async (
  editor: Editor,
  ipfsImageFetchFn?: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>,
  fetchV1ImageFn?: (url: string) => Promise<ArrayBuffer | undefined>,
) => {
  const originalDoc = editor.state.doc;
  const docWithEmbedImageContent =
    await searchForSecureImageNodeAndEmbedImageContent(
      originalDoc,
      ipfsImageFetchFn,
      fetchV1ImageFn,
      true,
    );

  const temporalEditor = getTemporaryEditor(
    editor,
    docWithEmbedImageContent.toJSON(),
  );

  const inlineHtml = temporalEditor.getHTML();

  setMarkdownSlideMedia(true);
  try {
    return turndownService.turndown(inlineHtml);
  } finally {
    setMarkdownSlideMedia(false);
    temporalEditor.destroy();
  }
};

export const processMarkdownContent = (markdown: string): Slides => {
  const slides: Slides = {};
  let currentSlideNumber = 0;
  let currentSlideContent: SlideContent[] = [];
  let isInTable = false;
  let tableContent = '';
  let tableRows: string[] = [];
  let currentCharCount = 0;
  let currentWordCount = 0;
  let currentLineCount = 0;
  const MAX_CHARS_PER_SLIDE = 1000;
  const MAX_WORDS_PER_SLIDE = 250;
  const MAX_LINES_PER_SLIDE = 8;

  const countWords = (text: string): number => {
    return text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
  };

  const shouldCreateNewSlide = (
    additionalText: string,
    additionalLines: number = 1,
  ): boolean => {
    const newChars = currentCharCount + additionalText.length;
    const newWords = currentWordCount + countWords(additionalText);
    const newLines = currentLineCount + additionalLines;
    return (
      newChars > MAX_CHARS_PER_SLIDE ||
      newWords > MAX_WORDS_PER_SLIDE ||
      newLines > MAX_LINES_PER_SLIDE
    );
  };

  // Helper function to create new slide
  const createNewSlide = () => {
    if (currentSlideContent.length > 0) {
      slides[currentSlideNumber] = currentSlideContent;
      currentSlideNumber++;
      currentSlideContent = [];
      currentCharCount = 0;
      currentWordCount = 0;
      currentLineCount = 0;
    }
  };

  // Split markdown by page breaks
  const sections = markdown.split('\n');

  sections.forEach((section) => {
    const lines = section.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Handle table start and content
      if (line.startsWith('|')) {
        if (!isInTable) {
          isInTable = true;
          tableRows = [];
        }
        tableRows.push(line);
        continue;
      }
      // Handle table separator row
      else if (line.startsWith('|-') || line.startsWith('| -')) {
        tableRows.push(line);
        continue;
      }
      // Handle table end
      else if (isInTable) {
        isInTable = false;
        if (tableRows.length > 0) {
          const tableText = tableRows.join('\n');
          if (
            shouldCreateNewSlide(tableText, tableRows.length) &&
            currentSlideContent.length > 0
          ) {
            createNewSlide();
          }

          // Ensure proper table formatting with newlines
          tableContent = '\n' + tableRows.join('\n') + '\n';
          currentSlideContent.push({
            type: 'table',
            content: tableContent.trim(),
          });
          currentCharCount += tableText.length;
          currentWordCount += countWords(tableText);
          currentLineCount += tableRows.length;
          tableRows = [];
          tableContent = '';
        }
      }

      // Handle page breaks
      if (line.startsWith('===')) {
        createNewSlide();
      }
      // Handle H1
      else if (line.startsWith('# ')) {
        createNewSlide();
        const content = line
          .substring(2)
          .replace(/^\*\*|\*\*$/g, '')
          .trim();
        slides[currentSlideNumber] = [
          {
            type: 'h1',
            content,
          },
        ];
        currentSlideNumber++;
        currentSlideContent = [];
        currentCharCount = 0;
        currentWordCount = 0;
        currentLineCount = 0;
      }
      // Handle H2
      else if (line.startsWith('## ')) {
        if (currentSlideContent.length > 0) {
          createNewSlide();
        }
        const content = line
          .substring(3)
          .replace(/^\*\*|\*\*$/g, '')
          .replace(/\\/g, '')
          .trim();
        currentSlideContent = [
          {
            type: 'h2',
            content,
          },
        ];
        currentCharCount = content.length;
        currentWordCount = countWords(content);
        currentLineCount = 1;
      }
      // Handle Images
      else if (line.match(/!\[.*\]\(.*\)/)) {
        const imgMatch = line.match(/!\[(.*)\]\((.*)\)/);
        if (imgMatch && currentSlideContent.length === 0) {
          slides[currentSlideNumber] = [
            {
              type: 'image',
              content: imgMatch[2],
            },
          ];
          currentSlideNumber++;
        } else {
          if (shouldCreateNewSlide(line)) {
            createNewSlide();
          }
          currentSlideContent.push({
            type: 'content',
            content: line,
          });
          currentCharCount += line.length;
          currentWordCount += countWords(line);
          currentLineCount++;
        }
        // Ensure the next paragraph starts on a new slide
        createNewSlide();
      } else if (line.length > 0 && !isInTable) {
        if (shouldCreateNewSlide(line)) {
          createNewSlide();
        }
        // Preserve sup/sub tags when adding content
        const content = line.replace(/<\/?[^>]+(>|$)/g, (match) => {
          // Preserve sup and sub tags
          if (match.match(/<\/?(?:sup|sub)>/i)) {
            return match;
          }
          return '';
        });
        currentSlideContent.push({
          type: 'content',
          content,
        });
        currentCharCount += content.length;
        currentWordCount += countWords(content);
        currentLineCount++;
      }
    }
  });

  // Handle any remaining table content
  if (tableRows.length > 0) {
    const tableText = tableRows.join('\n');
    if (
      shouldCreateNewSlide(tableText, tableRows.length) &&
      currentSlideContent.length > 0
    ) {
      createNewSlide();
    }
    tableContent = '\n' + tableRows.join('\n') + '\n';
    currentSlideContent.push({
      type: 'table',
      content: tableContent.trim(),
    });
  }

  // Add remaining content
  if (currentSlideContent.length > 0) {
    slides[currentSlideNumber] = currentSlideContent;
  }

  return slides;
};
