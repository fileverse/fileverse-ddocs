import React from 'react';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import cn from 'classnames';
import { LucideIcon, Tooltip } from '@fileverse/ui';
import { useEditingContext } from '../../hooks/use-editing-context';
import { useEditorContext } from '../../context/editor-context';
import { getThemeStyle } from '../../utils/document-styling';

export const PageBreakNodeView: React.FC<NodeViewProps> = ({
  editor,
  deleteNode,
}) => {
  const { isPreviewMode } = useEditingContext();
  const { documentStyling, theme, isFocusMode } = useEditorContext();
  const handleDeleteNode = () => {
    editor.commands.unsetPageBreak();
    deleteNode();
  };

  const themeBackgroundStyle = getThemeStyle(
    documentStyling?.background,
    theme,
  );

  // Apply document background styling to the page break gap
  const pageBreakStyle = {
    ...(themeBackgroundStyle && {
      background: themeBackgroundStyle,
    }),
  };

  return (
    <NodeViewWrapper
      className={cn(
        'flex relative w-[calc(100%+var(--padding-r)+var(--padding-l))] -translate-x-[var(--padding-l)] color-bg-secondary h-full justify-center items-center',
      )}
      style={pageBreakStyle}
    >
      <br
        data-type="page-break"
        data-page-break="true"
        style={{ pageBreakAfter: 'always' }}
      />
      {isFocusMode ? (
        <div className="flex group items-center cursor-pointer gap-4 w-[221px] h-[36px]">
          {/* Left line */}
          <div className="flex-1 h-px w-[64px]  bg-gradient-to-l from-[#E8EBEC] to-transparent" />

          {/* Label */}
          <span className="text-helper-text-sm group-hover:hidden color-text-secondary whitespace-nowrap">
            Page break
          </span>
          <span
            onClick={handleDeleteNode}
            className="text-helper-text-sm hidden group-hover:inline  color-text-secondary whitespace-nowrap"
          >
            Remove
          </span>

          {/* Right line */}
          <div className="flex-1 h-px w-[64px] bg-gradient-to-r from-[#E8EBEC] to-transparent" />
        </div>
      ) : (
        !isPreviewMode && (
          <div className="opacity-0 hover:opacity-100 transition-opacity duration-200">
            <div className="absolute top-[-15px] left-0 right-0 h-4">
              <div
                className="absolute inset-0 border-b-1 border-transparent"
                style={{
                  background:
                    'linear-gradient(to bottom, transparent, #FFDF0A33)',
                }}
              ></div>
            </div>

            <Tooltip
              sideOffset={5}
              position="bottom"
              text="Remove page breaker"
            >
              <LucideIcon
                name="PageBreakRemove"
                onClick={handleDeleteNode}
                className="color-text-secondary cursor-pointer"
              />
            </Tooltip>
            <div className="absolute bottom-[-15px] left-0 right-0 h-4">
              <div
                className="absolute inset-0 border-b-1 border-transparent"
                style={{
                  background:
                    'linear-gradient(to bottom, #FFDF0A33, transparent)',
                }}
              ></div>
            </div>
          </div>
        )
      )}
    </NodeViewWrapper>
  );
};
