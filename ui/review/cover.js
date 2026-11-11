// Refresh a project's cached cover from the live player the user already opened.
// No hidden player, renderOut(), seeking or background refresh queue.
export function createLiveCover({ source, save, visible = () => !document.hidden }) {
  let attemptedRevision = null, timer = null, stopped = false;
  return {
    update() {
      const revision = source.info.revision;
      if (stopped || !visible() || !revision || revision === attemptedRevision || source.seeking) return;
      // Skip the opening fade; copy directly during the frame callback, before a WebGL buffer is cleared.
      if (source.displayedTime < Math.min(2, source.duration * 0.3)) return;
      attemptedRevision = revision;
      let picture;
      try { picture = source.snapDisplayed(480); } catch { return; }
      if (!picture) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        timer = null;
        if (stopped || !visible() || source.info.revision !== revision) return;
        try {
          const data = picture.toDataURL('image/jpeg', 0.82);
          await save({ data, revision });
        } catch { /* A cover failure must not interrupt playback or retry on every frame. */ }
      }, 0);
    },
    destroy() { stopped = true; clearTimeout(timer); timer = null; }
  };
}
