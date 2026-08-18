import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

import {
  clampScreenShareTransform,
  INITIAL_SCREEN_SHARE_TRANSFORM,
  type ScreenShareTransform,
} from '../features/voice/screen-share-transform';

interface Point {
  x: number;
  y: number;
}

interface GestureSnapshot {
  distance: number;
  midpoint: Point;
  transform: ScreenShareTransform;
}

function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpoint(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export function ScreenShareViewport({
  children,
  streamId,
}: {
  children: ReactNode;
  streamId: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<GestureSnapshot | null>(null);
  const panRef = useRef<{ point: Point; transform: ScreenShareTransform } | null>(null);
  const [transform, setTransform] = useState(INITIAL_SCREEN_SHARE_TRANSFORM);

  useEffect(() => {
    pointersRef.current.clear();
    gestureRef.current = null;
    panRef.current = null;
    setTransform(INITIAL_SCREEN_SHARE_TRANSFORM);
  }, [streamId]);

  const clamp = (next: ScreenShareTransform) => {
    const bounds = rootRef.current?.getBoundingClientRect();
    return clampScreenShareTransform(next, bounds?.width ?? 0, bounds?.height ?? 0);
  };

  const beginRemainingGesture = () => {
    const points = [...pointersRef.current.values()];
    gestureRef.current = null;
    panRef.current =
      points.length === 1 && transform.scale > 1 ? { point: points[0]!, transform } : null;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    if (points.length === 2) {
      gestureRef.current = {
        distance: Math.max(1, distance(points[0]!, points[1]!)),
        midpoint: midpoint(points[0]!, points[1]!),
        transform,
      };
      panRef.current = null;
    } else if (points.length === 1 && transform.scale > 1) {
      panRef.current = { point: points[0]!, transform };
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    if (points.length >= 2 && gestureRef.current) {
      event.preventDefault();
      const currentMidpoint = midpoint(points[0]!, points[1]!);
      const snapshot = gestureRef.current;
      setTransform(
        clamp({
          scale: snapshot.transform.scale * (distance(points[0]!, points[1]!) / snapshot.distance),
          x: snapshot.transform.x + currentMidpoint.x - snapshot.midpoint.x,
          y: snapshot.transform.y + currentMidpoint.y - snapshot.midpoint.y,
        }),
      );
      return;
    }
    if (points.length === 1 && panRef.current && transform.scale > 1) {
      event.preventDefault();
      const currentPoint = points[0]!;
      setTransform(
        clamp({
          ...panRef.current.transform,
          x: panRef.current.transform.x + currentPoint.x - panRef.current.point.x,
          y: panRef.current.transform.y + currentPoint.y - panRef.current.point.y,
        }),
      );
    }
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    beginRemainingGesture();
  };

  return (
    <div
      ref={rootRef}
      className="screen-share-zoom-surface"
      data-zoom={transform.scale.toFixed(2)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <div
        className="screen-share-zoom-content"
        style={{
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
