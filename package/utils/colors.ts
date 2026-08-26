import Color, { ColorInstance } from 'color';
import { ThemeKey } from '../types';

export const colors = [
  { color: '#000000', code: 'bg-[#000000]' },
  { color: '#434343', code: 'bg-[#434343]' },
  { color: '#666666', code: 'bg-[#666666]' },
  { color: '#999999', code: 'bg-[#999999]' },
  { color: '#B7B7B7', code: 'bg-[#B7B7B7]' },
  { color: '#CCCCCC', code: 'bg-[#CCCCCC]' },
  { color: '#D9D9D9', code: 'bg-[#D9D9D9]' },
  { color: '#EFEFEF', code: 'bg-[#EFEFEF]' },
  { color: '#F3F3F3', code: 'bg-[#F3F3F3]' },
  { color: '#FFFFFF', code: 'bg-[#FFFFFF] border border-gray-200' },
  { color: '#980000', code: 'bg-[#980000]' },
  { color: '#FF0000', code: 'bg-[#FF0000]' },
  { color: '#FF9900', code: 'bg-[#FF9900]' },
  { color: '#FFFF00', code: 'bg-[#FFFF00]' },
  { color: '#00FF00', code: 'bg-[#00FF00]' },
  { color: '#00FFFF', code: 'bg-[#00FFFF]' },
  { color: '#4A86E8', code: 'bg-[#4A86E8]' },
  { color: '#0000FF', code: 'bg-[#0000FF]' },
  { color: '#9900FF', code: 'bg-[#9900FF]' },
  { color: '#FF00FF', code: 'bg-[#FF00FF]' },
  { color: '#E6B8AF', code: 'bg-[#E6B8AF]' },
  { color: '#F4CCCC', code: 'bg-[#F4CCCC]' },
  { color: '#FCE5CD', code: 'bg-[#FCE5CD]' },
  { color: '#FFF2CC', code: 'bg-[#FFF2CC]' },
  { color: '#D9EAD3', code: 'bg-[#D9EAD3]' },
  { color: '#D0E0E3', code: 'bg-[#D0E0E3]' },
  { color: '#C9DAF8', code: 'bg-[#C9DAF8]' },
  { color: '#CFE2F3', code: 'bg-[#CFE2F3]' },
  { color: '#D9D2E9', code: 'bg-[#D9D2E9]' },
  { color: '#EAD1DC', code: 'bg-[#EAD1DC]' },
  { color: '#DD7E6B', code: 'bg-[#DD7E6B]' },
  { color: '#EA9999', code: 'bg-[#EA9999]' },
  { color: '#F9CB9C', code: 'bg-[#F9CB9C]' },
  { color: '#FFE599', code: 'bg-[#FFE599]' },
  { color: '#B6D7A8', code: 'bg-[#B6D7A8]' },
  { color: '#A2C4C9', code: 'bg-[#A2C4C9]' },
  { color: '#A4C2F4', code: 'bg-[#A4C2F4]' },
  { color: '#9FC5E8', code: 'bg-[#9FC5E8]' },
  { color: '#B4A7D6', code: 'bg-[#B4A7D6]' },
  { color: '#D5A6BD', code: 'bg-[#D5A6BD]' },
  { color: '#CC4125', code: 'bg-[#CC4125]' },
  { color: '#E06666', code: 'bg-[#E06666]' },
  { color: '#F6B26B', code: 'bg-[#F6B26B]' },
  { color: '#FFD966', code: 'bg-[#FFD966]' },
  { color: '#93C47D', code: 'bg-[#93C47D]' },
  { color: '#76A5AF', code: 'bg-[#76A5AF]' },
  { color: '#6D9EEB', code: 'bg-[#6D9EEB]' },
  { color: '#6FA8DC', code: 'bg-[#6FA8DC]' },
  { color: '#8E7CC3', code: 'bg-[#8E7CC3]' },
  { color: '#C27BA0', code: 'bg-[#C27BA0]' },
  { color: '#A61C00', code: 'bg-[#A61C00]' },
  { color: '#CC0000', code: 'bg-[#CC0000]' },
  { color: '#E69138', code: 'bg-[#E69138]' },
  { color: '#F1C232', code: 'bg-[#F1C232]' },
  { color: '#6AA84F', code: 'bg-[#6AA84F]' },
  { color: '#45818E', code: 'bg-[#45818E]' },
  { color: '#3C78D8', code: 'bg-[#3C78D8]' },
  { color: '#3D85C6', code: 'bg-[#3D85C6]' },
  { color: '#674EA7', code: 'bg-[#674EA7]' },
  { color: '#A64D79', code: 'bg-[#A64D79]' },
  { color: '#85200C', code: 'bg-[#85200C]' },
  { color: '#990000', code: 'bg-[#990000]' },
  { color: '#B45F06', code: 'bg-[#B45F06]' },
  { color: '#BF9000', code: 'bg-[#BF9000]' },
  { color: '#38761D', code: 'bg-[#38761D]' },
  { color: '#134F5C', code: 'bg-[#134F5C]' },
  { color: '#1155CC', code: 'bg-[#1155CC]' },
  { color: '#0B5394', code: 'bg-[#0B5394]' },
  { color: '#351C75', code: 'bg-[#351C75]' },
  { color: '#741B47', code: 'bg-[#741B47]' },
  { color: '#5B0F00', code: 'bg-[#5B0F00]' },
  { color: '#660000', code: 'bg-[#660000]' },
  { color: '#783F04', code: 'bg-[#783F04]' },
  { color: '#7F6000', code: 'bg-[#7F6000]' },
  { color: '#274E13', code: 'bg-[#274E13]' },
  { color: '#0C343D', code: 'bg-[#0C343D]' },
  { color: '#1C4587', code: 'bg-[#1C4587]' },
  { color: '#073763', code: 'bg-[#073763]' },
  { color: '#20124D', code: 'bg-[#20124D]' },
  { color: '#4C1130', code: 'bg-[#4C1130]' },
];

export const textColors = [
  {
    name: 'rose',
    light: '#B30000',
    dark: '#FF6161',
  },
  {
    name: 'alata',
    light: '#B30036',
    dark: '#FF6179',
  },
  {
    name: 'fuchsia',
    light: '#AD005C',
    dark: '#FF4DCF',
  },
  {
    name: 'plum',
    light: '#A30085',
    dark: '#BA75FF',
  },
  {
    name: 'lilac',
    light: '#9400BD',
    dark: '#9985FF',
  },
  {
    name: 'violet',
    light: '#6800BD',
    dark: '#5294FF',
  },
  {
    name: 'blueberry',
    light: '#600AFF',
    dark: '#3D98FF',
  },
  {
    name: 'juniper',
    light: '#2930FF',
    dark: '#009AFA',
  },
  {
    name: 'acaiberry',
    light: '#0537FF',
    dark: '#00A4DB',
  },
  {
    name: 'teal',
    light: '#0056B3',
    dark: '#00ABB8',
  },
  {
    name: 'sage',
    light: '#005C7A',
    dark: '#00B5B8',
  },
  {
    name: 'viridiflora',
    light: '#00615F',
    dark: '#00E0C6',
  },
  {
    name: 'lxia',
    light: '#006144',
    dark: '#00FFD5',
  },
  {
    name: 'basil',
    light: '#006122',
    dark: '#00CC7E',
  },
  {
    name: 'snowpea',
    light: '#1A6100',
    dark: '#00FF88',
  },
  {
    name: 'rose-1',
    light: '#800000',
    dark: '#FF9999',
  },
  {
    name: 'alata-1',
    light: '#800026',
    dark: '#FFA8B5',
  },
  {
    name: 'fuchsia-1',
    light: '#7A0041',
    dark: '#FFA3E7',
  },
  {
    name: 'plum-1',
    light: '#7A0064',
    dark: '#D4A8FF',
  },
  {
    name: 'lilac-1',
    light: '#640080',
    dark: '#C8BDFF',
  },
  {
    name: 'violet-1',
    light: '#490085',
    dark: '#9EC3FF',
  },
  {
    name: 'blueberry-1',
    light: '#3D00AD',
    dark: '#85BEFF',
  },
  {
    name: 'juniper-1',
    light: '#0007CC',
    dark: '#66C4FF',
  },
  {
    name: 'acaiberry-1',
    light: '#002AD1',
    dark: '#4DD2FF',
  },
  {
    name: 'teal-1',
    light: '#00458F',
    dark: '#1FF0FF',
  },
  {
    name: 'sage-1',
    light: '#004961',
    dark: '#29FBFF',
  },
  {
    name: 'viridiflora-1',
    light: '#004D4A',
    dark: '#57FFEB',
  },
  {
    name: 'lxia-1',
    light: '#004D36',
    dark: '#70FFE7',
  },
  {
    name: 'basil-1',
    light: '#004D1B',
    dark: '#47FFB9',
  },
  {
    name: 'snowpea-1',
    light: '#165200',
    dark: '#75FFBF',
  },
  {
    name: 'rose-2',
    light: '#4D0000',
    dark: '#FFD1D1',
  },
  {
    name: 'alata-2',
    light: '#420014',
    dark: '#FFD6DD',
  },
  {
    name: 'fuchsia-2',
    light: '#4D0029',
    dark: '#FFD6F4',
  },
  {
    name: 'plum-2',
    light: '#420036',
    dark: '#E0C2FF',
  },
  {
    name: 'lilac-2',
    light: '#3C004D',
    dark: '#DDD6FF',
  },
  {
    name: 'violet-2',
    light: '#2A004D',
    dark: '#CCE0FF',
  },
  {
    name: 'blueberry-2',
    light: '#240066',
    dark: '#C2DEFF',
  },
  {
    name: 'juniper-2',
    light: '#000480',
    dark: '#A8DEFF',
  },
  {
    name: 'acaiberry-2',
    light: '#001A80',
    dark: '#B3ECFF',
  },
  {
    name: 'teal-2',
    light: '#002F61',
    dark: '#8AF7FF',
  },
  {
    name: 'sage-2',
    light: '#003447',
    dark: '#9EFDFF',
  },
  {
    name: 'viridiflora-2',
    light: '#003D3B',
    dark: '#9EFFF4',
  },
  {
    name: 'lxia-2',
    light: '#00422E',
    dark: '#B8FFF3',
  },
  {
    name: 'basil-2',
    light: '#003D15',
    dark: '#ADFFE0',
  },
  {
    name: 'snowpea-2',
    light: '#124200',
    dark: '#CCFFE7',
  },
  {
    name: 'moss',
    light: '#006614',
    dark: '#3DFF64',
  },
  {
    name: 'pine',
    light: '#0C6600',
    dark: '#00FF11',
  },
  {
    name: 'pea',
    light: '#006607',
    dark: '#44FF00',
  },
  {
    name: 'apple',
    light: '#1B6600',
    dark: '#44FF00',
  },
  {
    name: 'lime',
    light: '#325C00',
    dark: '#D4FF00',
  },
  {
    name: 'kiwi',
    light: '#485C00',
    dark: '#FFF700',
  },
  {
    name: 'oak',
    light: '#565C00',
    dark: '#FFE433',
  },
  {
    name: 'larch',
    light: '#5C5000',
    dark: '#FFDD00',
  },
  {
    name: 'walnut',
    light: '#705200',
    dark: '#FFBB00',
  },
  {
    name: 'teak',
    light: '#7A4E00',
    dark: '#FFA200',
  },
  {
    name: 'rosewood',
    light: '#854700',
    dark: '#FF8800',
  },
  {
    name: 'chestnut',
    light: '#8F4000',
    dark: '#FF7300',
  },
  {
    name: 'umber',
    light: '#993600',
    dark: '#FF622E',
  },
  {
    name: 'cedar',
    light: '#A82A00',
    dark: '#FF5900',
  },
  {
    name: 'canna',
    light: '#B30C00',
    dark: '#FF6257',
  },
  {
    name: 'moss-1',
    light: '#00420D',
    dark: '#99FFAD',
  },
  {
    name: 'pine-1',
    light: '#084700',
    dark: '#8AFF92',
  },
  {
    name: 'pea-1',
    light: '#005706',
    dark: '#9AFF75',
  },
  {
    name: 'apple-1',
    light: '#144D00',
    dark: '#A5FF85',
  },
  {
    name: 'lime-1',
    light: '#2A4D00',
    dark: '#E6FF66',
  },
  {
    name: 'kiwi-1',
    light: '#3C4D00',
    dark: '#FFFB7A',
  },
  {
    name: 'oak-1',
    light: '#3E4200',
    dark: '#FFEE80',
  },
  {
    name: 'larch-1',
    light: '#4D4100',
    dark: '#FFEA61',
  },
  {
    name: 'walnut-1',
    light: '#523C00',
    dark: '#FFD666',
  },
  {
    name: 'teak-1',
    light: '#664100',
    dark: '#FFBF52',
  },
  {
    name: 'rosewood-1',
    light: '#6B3900',
    dark: '#FFB35C',
  },
  {
    name: 'chestnut-1',
    light: '#6B3000',
    dark: '#FFAB66',
  },
  {
    name: 'umber-1',
    light: '#752900',
    dark: '#FF8861',
  },
  {
    name: 'cedar-1',
    light: '#852100',
    dark: '#FF8E52',
  },
  {
    name: 'canna-1',
    light: '#8F0A00',
    dark: '#FF8880',
  },
  {
    name: 'moss-2',
    light: '#00330A',
    dark: '#C7FFD6',
  },

  {
    name: 'pine-2',
    light: '#073D00',
    dark: '#C2FFC6',
  },

  {
    name: 'pea-2',
    light: '#003D04',
    dark: '#D6FFC7',
  },

  {
    name: 'apple-2',
    light: '#124200',
    dark: '#DAFFCC',
  },

  {
    name: 'lime-2',
    light: '#244200',
    dark: '#F3FFB8',
  },

  {
    name: 'kiwi-2',
    light: '#303D00',
    dark: '#FFFDB8',
  },

  {
    name: 'oak-2',
    light: '#343800',
    dark: '#FFF9D1',
  },

  {
    name: 'larch-2',
    light: '#3D3500',
    dark: '#FFF5B3',
  },

  {
    name: 'walnut-2',
    light: '#423200',
    dark: '#FFE59E',
  },

  {
    name: 'teak-2',
    light: '#523400',
    dark: '#FFDFA8',
  },

  {
    name: 'rosewood-2',
    light: '#472600',
    dark: '#FFDBB3',
  },

  {
    name: 'chestnut-2',
    light: '#522500',
    dark: '#FFD8B8',
  },

  {
    name: 'umber-2',
    light: '#4D1B00',
    dark: '#FFC2AD',
  },

  {
    name: 'cedar-2',
    light: '#5C1700',
    dark: '#FFC7A8',
  },

  {
    name: 'canna-2',
    light: '#3D0400',
    dark: '#FFB3AD',
  },
  {
    name: 'neutral',
    light: '#000000',
    dark: '#FFFFFF',
  },
  {
    name: 'neutral-1',
    light: '#080808',
    dark: '#F8F8F8',
  },
  {
    name: 'neutral-2',
    light: '#0F0F0F',
    dark: '#F0F0F0',
  },
  {
    name: 'neutral-3',
    light: '#171717',
    dark: '#E9E9E9',
  },
  {
    name: 'neutral-4',
    light: '#1E1E1E',
    dark: '#E1E1E1',
  },
  {
    name: 'neutral-5',
    light: '#262626',
    dark: '#DADADA',
  },
  {
    name: 'neutral-6',
    light: '#2D2D2D',
    dark: '#D2D2D2',
  },
  {
    name: 'neutral-7',
    light: '#353535',
    dark: '#CBCBCB',
  },
  {
    name: 'neutral-8',
    light: '#3C3C3C',
    dark: '#C3C3C3',
  },
  {
    name: 'neutral-9',
    light: '#444444',
    dark: '#BCBCBC',
  },
  {
    name: 'neutral-10',
    light: '#4B4B4B',
    dark: '#B4B4B4',
  },
  {
    name: 'neutral-11',
    light: '#696969',
    dark: '#969696',
  },
  {
    name: 'neutral-12',
    light: '#717171',
    dark: '#8F8F8F',
  },
  {
    name: 'neutral-13',
    light: '#787878',
    dark: '#878787',
  },
  {
    name: 'neutral-14',
    light: '#808080',
    dark: '#808080',
  },
];

// Mobile text-formatting sheet shows rows 1, 4 and 7 of the 7x15 palette.
const TEXT_COLOR_ROW = 15;
export const mobileTextColors = [0, 3, 6].flatMap((row) =>
  textColors.slice(row * TEXT_COLOR_ROW, (row + 1) * TEXT_COLOR_ROW),
);

// Text colors are stored as `var(--color-editor-<name>)`, resolved by
// theme-scoped CSS variables that only exist inside the editor. Substitute the
// concrete light-theme hex so standalone exports (markdown, ODT) render outside it.
const EDITOR_COLOR_VAR_HEX: Record<string, string> = textColors.reduce(
  (acc, c) => {
    acc[`--color-editor-${c.name}`] = c.light;
    return acc;
  },
  {} as Record<string, string>,
);

export const resolveEditorColorVars = (value: string): string =>
  value.replace(
    /var\((--color-editor-[^,)\s]+)(?:\s*,\s*([^)]+))?\)/g,
    (match, name, fallback) =>
      EDITOR_COLOR_VAR_HEX[name as string] ??
      (fallback ? (fallback as string).trim() : match),
  );

function lightenBy(color: ColorInstance, ratio: number) {
  const lightness = color.lightness();
  return color.lightness(lightness + (100 - lightness) * ratio).hex();
}

function darkenBy(color: ColorInstance, ratio: number) {
  const lightness = color.lightness();
  return color.lightness(lightness - lightness * ratio).hex();
}

export const getResponsiveColor = (
  color?: string,
  theme: ThemeKey = 'light',
) => {
  if (!color) return;
  try {
    if (color.startsWith('var(--color-editor-')) return color;
    const colorObj = Color(color);
    if (theme === 'dark' || theme === 'theme-green') {
      if (colorObj.isDark()) {
        if (colorObj.black() === 100) return colorObj.negate().hex(); // if the color is hard black, turn to white
        return lightenBy(colorObj, 0.5);
      }
      return color;
    } else {
      if (colorObj.isLight()) {
        if (colorObj.white() === 100) return colorObj.negate().hex(); // if the color is hard white, turn to black
        return darkenBy(colorObj, 0.3);
      }
      return color;
    }
  } catch {
    return color;
  }
};
