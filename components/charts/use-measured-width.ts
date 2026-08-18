"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Track a container's pixel width so charts can be drawn at real coordinates.
 *
 * Scaling one fixed viewBox with CSS would scale the type with it, and these
 * charts render both on a full-width dashboard and inside the narrow assistant
 * panel — the labels have to stay the same size in both.
 */
export function useMeasuredWidth<T extends HTMLElement>(
  fallback: number,
): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const measured = entry.contentRect.width;
      if (measured > 0) setWidth(Math.round(measured));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
