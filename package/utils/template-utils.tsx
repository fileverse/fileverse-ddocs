import { JSONContent } from '@tiptap/react';

import {
  Button,
  ButtonGroup,
  cn,
  Divider,
  DynamicDropdown,
  LucideIcon,
  LucideIconProps,
  UltimateIcons,
} from '@fileverse/ui';
import { getTemplateContent } from './getTemplateContent';

type IconType = LucideIconProps['name'] | string;

type TemplateButtonProps = {
  label: string;
  icon: IconType;
  onClick: () => void;
  content: JSONContent | null;
}[];

type TemplateConfig = {
  id: string;
  label: string;
  icon: IconType;
};

const MORE_TEMPLATES: TemplateConfig[] = [
  {
    id: 'meeting-notes',
    label: 'Meeting notes',
    icon: 'NotepadText',
  },
  {
    id: 'resume',
    label: 'Resume',
    icon: '📄',
  },
  {
    id: 'brainstorm',
    label: 'Brainstorm',
    icon: 'Lightbulb',
  },
  {
    id: 'pretend-to-work',
    label: 'Pretend to work',
    icon: '🏄🏻‍♂️',
  },
];

const QUICK_TEMPLATES: TemplateConfig[] = [
  {
    id: 'todo-list',
    label: 'To-do',
    icon: 'ListChecks',
  },
  {
    id: 'breathe',
    label: 'Breathe!',
    icon: '🧘‍♂️',
  },
];

const createTemplateButton = (
  config: TemplateConfig,
  addTemplate: (template: JSONContent) => void,
) => {
  const content = getTemplateContent(config.id);
  return {
    label: config.label,
    icon: config.icon,
    onClick: () => {
      if (content) addTemplate(content);
    },
    content,
  };
};

const createMoreTemplates = (
  addTemplate: (template: JSONContent) => void,
): TemplateButtonProps =>
  MORE_TEMPLATES.map((config) => createTemplateButton(config, addTemplate));

const createTemplateButtons = (
  addTemplate: (template: JSONContent) => void,
): TemplateButtonProps =>
  QUICK_TEMPLATES.map((config) => createTemplateButton(config, addTemplate));

const renderIcon = (icon: IconType, className?: string) => {
  if (
    typeof icon === 'string' &&
    UltimateIcons[icon as keyof typeof UltimateIcons]
  ) {
    return (
      <LucideIcon
        name={icon as keyof typeof UltimateIcons}
        className={className}
      />
    );
  } else if (typeof icon === 'string') {
    return <span className={className}>{icon}</span>;
  }
  return null;
};

const renderTemplateButtons = (
  templateButtons: TemplateButtonProps,
  moreTemplates: TemplateButtonProps,
  visibleTemplateCount: number,
  toggleAllTemplates: () => void,
  isExpanded: boolean,
  isCollaboratorsDoc: boolean,
  isPreviewMode: boolean,
  isFocusMode: boolean,
) => {
  if (isCollaboratorsDoc || isPreviewMode || isFocusMode) {
    return null;
  }
  return (
    <ButtonGroup className="template-buttons space-x-0 gap-2 group-has-[.is-editor-empty[dir='rtl']]/collision:md:!left-0 group-has-[.is-editor-empty[dir='rtl']]/collision:md:!right-[unset]">
      {templateButtons.map((button, index) => (
        <Button
          key={index}
          onClick={button.onClick}
          variant={'ghost'}
          className="gap-2 color-bg-default-hover text-body-sm color-text-default rounded-lg hover:brightness-95 transition-all min-w-fit"
        >
          {renderIcon(button.icon)}
          <span>{button.label}</span>
        </Button>
      ))}
      <DynamicDropdown
        key={'More Templates'}
        align="end"
        sideOffset={10}
        anchorTrigger={
          <Button
            variant={'ghost'}
            className="gap-2 color-bg-default-hover text-body-sm color-text-default rounded-lg hover:brightness-95 transition-all w-full min-w-0 !p-[10px]"
          >
            <LucideIcon name={'Ellipsis'} className="color-text-default" />
          </Button>
        }
        content={
          <div className="flex flex-col gap-1 p-2 w-[12rem]">
            <div className="max-h-44 overflow-auto gap-1 flex flex-col">
              {moreTemplates
                .slice(0, visibleTemplateCount)
                .map((button, index) => (
                  <Button
                    key={index}
                    onClick={button.onClick}
                    variant={'ghost'}
                    className="justify-start gap-2 text-body-sm color-text-default min-w-fit px-2 rounded-lg"
                  >
                    {renderIcon(button.icon)}
                    <span>{button.label}</span>
                  </Button>
                ))}
            </div>
            <Divider className="w-full !border-t-[1px]" />
            <Button
              variant={'ghost'}
              className="justify-between gap-2 text-body-sm color-text-default min-w-fit px-2 rounded-lg"
              onClick={toggleAllTemplates}
            >
              <span>{isExpanded ? 'Less' : 'More'}</span>
              <LucideIcon
                name="ChevronDown"
                size="sm"
                className={cn(isExpanded ? 'rotate-180' : '')}
              />
            </Button>
          </div>
        }
      />
    </ButtonGroup>
  );
};
export {
  renderIcon,
  createTemplateButtons,
  createMoreTemplates,
  renderTemplateButtons,
};
