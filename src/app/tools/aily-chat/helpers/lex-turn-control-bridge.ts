import type { SessionSnapshot } from 'aily-lex/browser';

interface TurnControlLike {
  getCurrentTurnId(): string | undefined;
  startTurn(content: string): string | undefined;
  completeTurn(response: string): void;
  failTurn(): void;
  removeIncomplete(): boolean;
  removeFromTurn(turnId: string): void;
  truncateToTurn(turnId: string): void;
  clearTurns(): void;
  toSnapshot(): SessionSnapshot | null;
}

export class LexTurnControlBridge {
  constructor(private readonly turnControl: TurnControlLike) {}

  currentId(): string | undefined {
    return this.turnControl.getCurrentTurnId();
  }

  start(content: string): string | undefined {
    return this.turnControl.startTurn(content);
  }

  complete(response: string): void {
    this.turnControl.completeTurn(response);
  }

  fail(): void {
    this.turnControl.failTurn();
  }

  discardIncomplete(): boolean {
    return this.turnControl.removeIncomplete();
  }

  removeFrom(turnId: string): void {
    this.turnControl.removeFromTurn(turnId);
  }

  restartFrom(turnId: string): void {
    this.turnControl.truncateToTurn(turnId);
  }

  clear(): void {
    this.turnControl.clearTurns();
  }

  snapshot(): SessionSnapshot | null {
    return this.turnControl.toSnapshot();
  }
}