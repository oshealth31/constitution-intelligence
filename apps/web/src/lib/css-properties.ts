'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * Sets CSS custom properties (such as --brand-primary or --bar-width) on an element through
 * the browser's style API, after the page has loaded (Task D13).
 *
 * The site's Content Security Policy does not allow inline style="" attributes or <style>
 * blocks written into the page (an injected one could change how a page looks). Setting
 * properties from the site's own script is allowed. Every value passed here must already be
 * checked (colours: exact #RRGGBB codes; widths: numbers).
 */
export function useCssProperties<T extends HTMLElement>(
  properties: Record<string, string> | null | undefined,
) {
  const ref = useRef<T>(null);
  const key = properties ? JSON.stringify(properties) : '';
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !properties) return;
    const names = Object.keys(properties);
    for (const name of names) element.style.setProperty(name, properties[name]!);
    return () => {
      for (const name of names) element.style.removeProperty(name);
    };
    // `key` is the serialised `properties`: re-run only when the values change.
  }, [key]);
  return ref;
}
