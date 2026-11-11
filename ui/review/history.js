// Undo / redo by snapshots (strings). A drag arms the state before it and pushes it only on its first real change,
// so a click that moves nothing leaves no step; any other edit pushes before it changes. Pure (history.test.js).
export function createHistory({ snapshot, restore, max = 60, onPush }) {
  let undo = [], redo = [], armed = null;
  function add(s) {
    if (undo.length && undo[undo.length - 1] === s) return;   // nothing changed since the last step
    undo.push(s); if (undo.length > max) undo.shift();
    redo = []; onPush?.();
  }
  return {
    arm() { armed = snapshot(); },
    touch() { if (armed != null) { const s = armed; armed = null; add(s); } },
    push() { armed = null; add(snapshot()); },
    undo() {
      armed = null;
      const now = snapshot();
      while (undo.length && undo[undo.length - 1] === now) undo.pop();   // a step that changed nothing
      if (!undo.length) return false;
      redo.push(now); restore(undo.pop()); return true;
    },
    redo() {
      armed = null;
      if (!redo.length) return false;
      undo.push(snapshot()); restore(redo.pop()); return true;
    },
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    clear() { undo = []; redo = []; armed = null; },
  };
}
