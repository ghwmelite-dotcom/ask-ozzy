import type { BoardAction, LessonStep } from '@/types/lesson';
import type { WhiteboardHandle } from './Whiteboard';

export class WhiteboardTeacher {
  private shapeCounter = 0;

  constructor(private board: WhiteboardHandle) {}

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
        this.board.clear();
        break;
    }
  }

  private drawShape(action: BoardAction & { action: 'drawShape' }): void {
    const id = `shape-${this.shapeCounter++}`;

    if (action.points && action.points.length >= 2) {
      // Polygon (triangle, etc.)
      this.board.addElement({
        id,
        type: 'polygon',
        points: action.points,
        color: '#ffffff',
      });
    } else if (action.position) {
      // Rectangle or circle
      const shapeType = action.type === 'circle' ? 'circle' : 'rect';
      this.board.addElement({
        id,
        type: shapeType,
        x: action.position[0],
        y: action.position[1],
        width: action.width ?? 60,
        height: action.height ?? 60,
        color: '#ffffff',
      });
    }

    // Right angle marker
    if (action.type === 'rightAngleMarker' && action.position) {
      this.board.addElement({
        id: `${id}-marker`,
        type: 'line',
        points: [
          [action.position[0] - 15, action.position[1]],
          [action.position[0] - 15, action.position[1] - 15],
          [action.position[0], action.position[1] - 15],
        ],
        color: '#FCD116',
      });
    }
  }

  private addLabel(action: BoardAction & { action: 'addLabel' }): void {
    this.board.addElement({
      id: `label-${this.shapeCounter++}`,
      type: 'text',
      x: action.position[0],
      y: action.position[1],
      text: action.text,
      color: action.color ?? '#ffffff',
      fontSize: 16,
    });
  }

  private drawLine(action: BoardAction & { action: 'drawLine' }): void {
    if (action.points.length < 2) return;
    this.board.addElement({
      id: `line-${this.shapeCounter++}`,
      type: 'line',
      points: action.points,
      color: action.color ?? '#ffffff',
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  reset(): void {
    this.board.clear();
    this.shapeCounter = 0;
  }
}
