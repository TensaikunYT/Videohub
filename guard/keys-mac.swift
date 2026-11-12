// VideoHubKeys: the emergency hotkeys of VideoHub's render protection on a Mac (the agent, guard/agent-mac.mjs, starts
// it and reads its output). Carbon hotkeys work system-wide without the Accessibility permission. No window, no Dock
// icon. It prints "ready", then "pause" for ⌃⌥⌘P (or ⌃⌥End: fn+→ on a laptop) and "resume" for ⌃⌥⌘R (⌃⌥Home), and
// exits when the agent does (its standard input closes).
// Build: guard/build-mac.sh (swiftc, part of Xcode or the Command Line Tools; macOS 11 or newer).
import Cocoa
import Carbon.HIToolbox

setvbuf(stdout, nil, _IOLBF, 0)
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

func say(_ s: String) { print(s); fflush(stdout) }

var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
InstallEventHandler(GetApplicationEventTarget(), { _, event, _ -> OSStatus in
  var id = EventHotKeyID()
  GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
  say(id.id == 1 ? "pause" : "resume")
  return noErr
}, 1, &spec, nil, nil)

var refs: [EventHotKeyRef?] = []
var ok = true
func register(_ key: Int, _ mods: Int, _ id: UInt32) {
  var ref: EventHotKeyRef?
  let r = RegisterEventHotKey(UInt32(key), UInt32(mods), EventHotKeyID(signature: OSType(0x5648_4B59), id: id), GetApplicationEventTarget(), 0, &ref)
  if r == noErr { refs.append(ref) } else { ok = false }
}
register(kVK_ANSI_P, controlKey | optionKey | cmdKey, 1)
register(kVK_ANSI_R, controlKey | optionKey | cmdKey, 2)
register(kVK_End, controlKey | optionKey, 1)
register(kVK_Home, controlKey | optionKey, 2)
say(ok ? "ready" : "ready partial")

// the agent closes our stdin when it exits (or dies): quit then
FileHandle.standardInput.readabilityHandler = { h in if h.availableData.isEmpty { exit(0) } }
app.run()
