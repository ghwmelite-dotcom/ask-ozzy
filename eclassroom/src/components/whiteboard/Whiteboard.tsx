import { useRef, useEffect, useImperativeHandle, forwardRef, useState, useCallback } from 'react';

export interface WhiteboardElement {
  id: string;
  type: 'polygon' | 'text' | 'line' | 'rect' | 'circle';
  points?: number[][];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  color?: string;
  fontSize?: number;
  opacity?: number;
}

export interface WhiteboardHandle {
  addElement: (el: WhiteboardElement) => void;
  clear: () => void;
  getElements: () => WhiteboardElement[];
}

interface WhiteboardProps {
  onReady?: (handle: WhiteboardHandle) => void;
}

export const Whiteboard = forwardRef<WhiteboardHandle, WhiteboardProps>(
  function Whiteboard({ onReady }, ref) {
    const [elements, setElements] = useState<WhiteboardElement[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);

    const addElement = useCallback((el: WhiteboardElement) => {
      setElements(prev => [...prev, { ...el, opacity: 0 }]);
      // Fade in
      requestAnimationFrame(() => {
        setElements(prev => prev.map(e => e.id === el.id ? { ...e, opacity: 1 } : e));
      });
    }, []);

    const clear = useCallback(() => {
      setElements([]);
    }, []);

    const getElements = useCallback(() => elements, [elements]);

    const handle: WhiteboardHandle = { addElement, clear, getElements };

    useImperativeHandle(ref, () => handle, [addElement, clear, getElements]);

    useEffect(() => {
      onReady?.(handle);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const renderElement = (el: WhiteboardElement) => {
      const style = { transition: 'opacity 0.4s ease', opacity: el.opacity ?? 1 };

      switch (el.type) {
        case 'polygon':
          if (!el.points || el.points.length < 2) return null;
          return (
            <polygon
              key={el.id}
              points={el.points.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke={el.color ?? '#ffffff'}
              strokeWidth="2"
              strokeLinejoin="round"
              style={style}
            />
          );

        case 'line':
          if (!el.points || el.points.length < 2) return null;
          return (
            <polyline
              key={el.id}
              points={el.points.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke={el.color ?? '#ffffff'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={style}
            />
          );

        case 'text':
          return (
            <text
              key={el.id}
              x={el.x ?? 0}
              y={el.y ?? 0}
              fill={el.color ?? '#ffffff'}
              fontSize={el.fontSize ?? 16}
              fontFamily="Inter, sans-serif"
              fontWeight="600"
              style={style}
            >
              {el.text}
            </text>
          );

        case 'rect':
          return (
            <rect
              key={el.id}
              x={el.x ?? 0}
              y={el.y ?? 0}
              width={el.width ?? 50}
              height={el.height ?? 50}
              fill="none"
              stroke={el.color ?? '#ffffff'}
              strokeWidth="2"
              rx="2"
              style={style}
            />
          );

        case 'circle':
          return (
            <circle
              key={el.id}
              cx={(el.x ?? 0) + (el.width ?? 50) / 2}
              cy={(el.y ?? 0) + (el.height ?? 50) / 2}
              r={Math.min(el.width ?? 50, el.height ?? 50) / 2}
              fill="none"
              stroke={el.color ?? '#ffffff'}
              strokeWidth="2"
              style={style}
            />
          );

        default:
          return null;
      }
    };

    return (
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{
          background: 'linear-gradient(180deg, #0d1520 0%, #142030 50%, #0d1520 100%)',
          position: 'relative',
        }}
      >
        {/* Grid lines for chalkboard feel */}
        <svg
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0, opacity: 0.06 }}
        >
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#FCD116" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Drawing canvas */}
        <svg
          viewBox="0 0 400 300"
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', inset: 0 }}
        >
          {elements.map(renderElement)}
        </svg>

        {/* Whiteboard label */}
        {elements.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.15)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18" />
              </svg>
              <p style={{ fontSize: 13, marginTop: 8 }}>Press Play to start the lesson</p>
            </div>
          </div>
        )}
      </div>
    );
  }
);
