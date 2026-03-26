import type { Editor } from 'tldraw';
import { createShapeId, compressLegacySegments, toRichText } from '@tldraw/tlschema';
import type { TLDefaultColorStyle } from '@tldraw/tlschema';
import type { BoardAction, LessonStep } from '@/types/lesson';

export class WhiteboardTeacher {
  private shapeCounter = 0;

  constructor(private editor: Editor) {}

  async executeStep(step: LessonStep): Promise<void> {
    for (const action of step.board_actions) {
      if (action.delay_ms > 0) {
        await this.delay(action.delay_ms);
      }
      this.executeAction(action);
    }
  }

  private executeAction(action: BoardAction): void {
    switch (action.action) {
      case 'drawShape':
        this.drawShape(action);
        break;
      case 'addLabel':
        this.addLabel(action);
        break;
      case 'drawLine':
        this.drawLine(action);
        break;
      case 'clearBoard':
        this.clearBoard();
        break;
    }
  }

  private drawShape(action: BoardAction & { action: 'drawShape' }): void {
    if (action.points && action.points.length >= 3) {
      // Draw as freehand polygon using draw shape
      const firstPoint = action.points[0];
      if (!firstPoint) return;
      const legacyPoints = action.points.map(([x, y]) => ({ x: x!, y: y!, z: 0.5 }));
      // Close the shape by adding the first point at the end
      legacyPoints.push({ x: firstPoint[0]!, y: firstPoint[1]!, z: 0.5 });

      const segments = compressLegacySegments([{
        type: 'free' as const,
        points: legacyPoints,
      }]);

      this.editor.createShape({
        id: createShapeId(`wb-${this.shapeCounter++}`),
        type: 'draw',
        x: 0,
        y: 0,
        props: {
          segments,
          color: 'white' as TLDefaultColorStyle,
          size: 'm',
          isClosed: true,
          isComplete: true,
        },
      });
    } else if (action.position && action.width && action.height) {
      this.editor.createShape({
        id: createShapeId(`wb-${this.shapeCounter++}`),
        type: 'geo',
        x: action.position[0],
        y: action.position[1],
        props: {
          geo: action.type === 'circle' ? 'ellipse' : 'rectangle',
          w: action.width,
          h: action.height,
          color: 'white' as TLDefaultColorStyle,
          fill: 'none',
          size: 'm',
        },
      });
    }
  }

  private addLabel(action: BoardAction & { action: 'addLabel' }): void {
    this.editor.createShape({
      id: createShapeId(`wb-${this.shapeCounter++}`),
      type: 'text',
      x: action.position[0],
      y: action.position[1],
      props: {
        richText: toRichText(action.text),
        color: this.mapColor(action.color),
        size: 'm',
        autoSize: true,
      },
    });
  }

  private drawLine(action: BoardAction & { action: 'drawLine' }): void {
    if (action.points.length < 2) return;

    const segments = compressLegacySegments([{
      type: 'free' as const,
      points: action.points.map(([x, y]) => ({ x, y, z: 0.5 })),
    }]);

    this.editor.createShape({
      id: createShapeId(`wb-${this.shapeCounter++}`),
      type: 'draw',
      x: 0,
      y: 0,
      props: {
        segments,
        color: this.mapColor(action.color),
        size: 'm',
        isComplete: true,
      },
    });
  }

  private clearBoard(): void {
    const allShapeIds = this.editor.getCurrentPageShapeIds();
    if (allShapeIds.size > 0) {
      this.editor.deleteShapes([...allShapeIds]);
    }
  }

  private mapColor(hex?: string): TLDefaultColorStyle {
    if (!hex) return 'white';
    const colorMap: Record<string, TLDefaultColorStyle> = {
      '#FCD116': 'yellow',
      '#EF9F27': 'orange',
      '#4FC3F7': 'light-blue',
      '#81C784': 'light-green',
      '#FF5252': 'red',
      '#CE1126': 'red',
      '#FFFFFF': 'white',
      '#ffffff': 'white',
    };
    return colorMap[hex] ?? 'white';
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  reset(): void {
    this.clearBoard();
    this.shapeCounter = 0;
  }
}
