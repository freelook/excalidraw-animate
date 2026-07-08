import { useCallback, useEffect, useState } from 'react';

import {
  exportToSvg,
  restoreElements,
  loadLibraryFromBlob,
  getNonDeletedElements,
} from '@excalidraw/excalidraw';

import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

import { loadScene } from './vendor/loadScene';
import { animateSvg } from './animate';

const THEME_FILTER = 'invert(93%) hue-rotate(180deg)';
const IMAGE_CORRECTION = 'invert(100%) hue-rotate(180deg) saturate(1.25)';
const EMOJI_CORRECTION = IMAGE_CORRECTION;
const EMOJI_REGEX = /\p{Extended_Pictographic}/u;
const SVG_NS = 'http://www.w3.org/2000/svg';

type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: 'grapheme' },
) => {
  segment: (text: string) => Iterable<{ segment: string }>;
};

const appendFilter = (ele: SVGElement, filter: string) => {
  const current = ele.style.filter?.trim() || '';
  if (!current.includes(filter)) {
    ele.style.filter = current ? `${current} ${filter}` : filter;
  }
};

const splitGraphemes = (text: string) => {
  const Segmenter = (
    Intl as typeof Intl & { Segmenter?: SegmenterConstructor }
  ).Segmenter;

  if (!Segmenter) {
    return Array.from(text);
  }

  return Array.from(
    new Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    ({ segment }) => segment,
  );
};

const correctEmojiTextNode = (node: Text) => {
  const text = node.textContent || '';
  if (!EMOJI_REGEX.test(text)) {
    return;
  }

  const fragment = node.ownerDocument.createDocumentFragment();
  splitGraphemes(text).forEach((segment) => {
    if (!EMOJI_REGEX.test(segment)) {
      fragment.appendChild(node.ownerDocument.createTextNode(segment));
      return;
    }

    const tspan = node.ownerDocument.createElementNS(SVG_NS, 'tspan');
    tspan.textContent = segment;
    appendFilter(tspan, EMOJI_CORRECTION);
    fragment.appendChild(tspan);
  });
  node.replaceWith(fragment);
};

const correctEmojiText = (ele: SVGTextElement | SVGTextPathElement) => {
  Array.from(ele.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      correctEmojiTextNode(node as Text);
    }
  });
};

export const applyThemeToSvg = (
  svg: SVGSVGElement,
  theme: 'light' | 'dark',
): SVGSVGElement => {
  if (theme !== 'dark') return svg;

  const cloned = svg.cloneNode(true) as SVGSVGElement;

  // Global filter (sourced from Excalidraw's THEME_FILTER in
  // packages/common/src/constants.ts; planned to mirror CSS --theme-filter)
  cloned.style.filter = THEME_FILTER;

  // Apply image-only correction (approx. of Excalidraw's Canvas IMAGE_INVERT_FILTER
  // in packages/element/src/renderElement.ts)
  cloned.querySelectorAll<SVGImageElement>('image').forEach((img) => {
    const href =
      img.getAttribute('href') || img.getAttribute('xlink:href') || '';

    // skip SVGs
    if (/^data:image\/svg\+xml/i.test(href) || /\.svg(?:$|\?)/i.test(href)) {
      return;
    }

    appendFilter(img, IMAGE_CORRECTION);
  });

  cloned
    .querySelectorAll<SVGTextPathElement>('textPath')
    .forEach(correctEmojiText);
  cloned.querySelectorAll<SVGTextElement>('text').forEach(correctEmojiText);

  return cloned;
};

const importLibraryFromUrl = async (url: string) => {
  try {
    const request = await fetch(url);
    const blob = await request.blob();
    const libraryItems = await loadLibraryFromBlob(blob);
    return libraryItems.map((libraryItem) =>
      getNonDeletedElements(restoreElements(libraryItem.elements, null)),
    );
  } catch {
    window.alert('Unable to load library');
    return [];
  }
};

export const useLoadSvg = (
  initialData:
    | { elements: ExcalidrawElement[]; appState: AppState; files: BinaryFiles }
    | undefined,
  theme: 'light' | 'dark',
) => {
  const [loading, setLoading] = useState(true);
  const [loadedSvgList, setLoadedSvgList] = useState<
    {
      svg: SVGSVGElement;
      finishedMs: number;
    }[]
  >([]);

  const loadDataList = useCallback(
    async (
      dataList: {
        elements: readonly ExcalidrawElement[];
        appState: Parameters<typeof exportToSvg>[0]['appState'];
        files: BinaryFiles;
      }[],
      inSequence?: boolean,
    ) => {
      const hash = window.location.hash.slice(1);
      const searchParams = new URLSearchParams(hash);
      const options = {
        startMs: undefined as number | undefined,
        pointerImg: searchParams.get('pointerImg') || undefined,
        pointerWidth: searchParams.get('pointerWidth') || undefined,
        pointerHeight: searchParams.get('pointerHeight') || undefined,
      };
      const svgList = await Promise.all(
        dataList.map(async (data) => {
          const elements = getNonDeletedElements(data.elements).filter((el) => {
            if (el.type !== 'image') return true;
            const fileId = (el as { fileId?: string | null }).fileId;
            return fileId != null && data.files[fileId] != null;
          });
          const svg = await exportToSvg({
            elements,
            files: data.files,
            appState: data.appState,
            exportPadding: 30,
          });
          const result = animateSvg(svg, elements, options);
          const themedSvg = applyThemeToSvg(svg, theme);
          if (inSequence) {
            options.startMs = result.finishedMs;
          }
          return { svg: themedSvg, finishedMs: result.finishedMs };
        }),
      );
      setLoadedSvgList(svgList);
      return svgList;
    },
    [theme],
  );

  useEffect(() => {
    (async () => {
      try {
        const hash = window.location.hash.slice(1);
        const searchParams = new URLSearchParams(hash);
        const matchIdKey = /([a-zA-Z0-9_-]+),?([a-zA-Z0-9_-]*)/.exec(
          searchParams.get('json') || '',
        );
        if (matchIdKey) {
          const [, id, key] = matchIdKey;
          const data = await loadScene(id, key, null);
          const [{ svg, finishedMs }] = await loadDataList([data]);
          if (searchParams.get('autoplay') === 'no') {
            svg.setCurrentTime(finishedMs);
          }
        }
        const matchLibrary = /(.*\.excalidrawlib)/.exec(
          searchParams.get('library') || '',
        );
        if (matchLibrary) {
          const [, url] = matchLibrary;
          const dataList = await importLibraryFromUrl(url);
          const svgList = await loadDataList(
            dataList.map((elements) => ({ elements, appState: {}, files: {} })),
            searchParams.has('sequence'),
          );
          if (searchParams.get('autoplay') === 'no') {
            svgList.forEach(({ svg, finishedMs }) => {
              svg.setCurrentTime(finishedMs);
            });
          }
        }
        if (!matchIdKey && !matchLibrary && initialData) {
          await loadDataList([initialData]);
        }
      } catch (e) {
        console.error('Failed to load SVG:', e);
        throw e;
      } finally {
        setLoading(false);
      }
    })();
  }, [loadDataList, initialData]);

  return { loading, loadedSvgList, loadDataList };
};
