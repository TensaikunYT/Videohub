// History management: Undo / Redo command stack (up to 150 steps)

export class History {
  constructor(maxSteps = 150) {
    this.maxSteps = maxSteps;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) {
      try { fn(this.canUndo(), this.canRedo()); } catch { }
    }
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  // Record an action: { undo: () => void, redo: () => void }
  push(command) {
    if (!command || typeof command.undo !== 'function' || typeof command.redo !== 'function') return;
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxSteps) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Clear redo stack on new action
    this.notify();
  }

  undo() {
    if (!this.canUndo()) return;
    const cmd = this.undoStack.pop();
    try { cmd.undo(); } catch (e) { console.error('Undo error:', e); }
    this.redoStack.push(cmd);
    this.notify();
  }

  redo() {
    if (!this.canRedo()) return;
    const cmd = this.redoStack.pop();
    try { cmd.redo(); } catch (e) { console.error('Redo error:', e); }
    this.undoStack.push(cmd);
    this.notify();
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }
}
