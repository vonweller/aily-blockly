import * as Blockly from 'blockly/core';
// @ts-ignore
import { Coordinate } from 'blockly/core/utils/coordinate';

export class BlockDragStrategy implements Blockly.IDragStrategy {
  drag(newLoc: Coordinate, e?: PointerEvent): void {
    console.log(11112222);
  }

  endDrag(e?: PointerEvent): void {}

  isMovable(): boolean {
    return false;
  }

  revertDrag(): void {}

  startDrag(e?: PointerEvent): void {}
}
