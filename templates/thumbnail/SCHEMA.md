# VideoHub · Thumbnail Template Format (SCHEMA.md)

This document describes the JSON structure of VideoHub Thumbnail Studio templates. Both developers and AI (Claude) can follow this specification to create new templates.

---

## 1. Overall Structure

Each template file is a JSON object with the following top-level fields:

```jsonc
{
  "v": 1,
  "kind": "thumbstudio-template",
  "id": "template-id",                // Unique, URL-friendly id (kebab-case); same as the file name
  "name": "Template Title",           // Name shown to the user
  "desc": "Short template description", // What kind of videos it suits
  "format": "16:9",                   // "16:9" (YouTube) or "9:16" (Shorts)
  "tags": ["face", "text", "classic"], // Tags for search and filtering
  "slots": {                          // Editable placeholders
    "SLOT_NAME": {
      "label": "Label shown in the form",
      "default": "Default value"
    }
  },
  "camera": { ... },                  // Camera and angle settings
  "light": { ... },                   // Lighting settings
  "style": { ... },                   // Style and palette
  "text": { ... },                    // Text policy
  "layers": [ ... ]                   // Layers in the scene
}
```

---

## 2. Coordinate System

All position and size values are **normalised between 0.0 and 1.0** (relative to the canvas width and height).
- `x`: Distance from the left edge (0 = far left, 1 = far right)
- `y`: Distance from the top edge (0 = top, 1 = bottom)
- `w`: Width ratio (0.5 = half the canvas)
- `h`: Height ratio (0.5 = half the canvas)
- `rot`: Rotation in degrees (-180..180)
- `depth`: Depth (0 = closest to the camera / foreground, 100 = farthest / background)

---

## 3. Slots (Variables)

Any text field in a template (for example `desc`, `content`, `topic`) can use the `{{SLOT_NAME}}` syntax.
When the user picks the template, a form opens for filling in these slots, and the values are injected into the text. Slot names use uppercase letters, digits and underscores.

---

## 4. Allowed Values

### 4.1 Camera (`camera`)
- `shot`: `"extreme-close"` | `"close"` | `"medium"` | `"cowboy"` | `"full"` | `"wide"` | `"extreme-wide"`
- `angle`: `"eye"` | `"low"` | `"high"` | `"birds-eye"` | `"worms-eye"` | `"overhead"` | `"dutch"`
- `lens`: `14` | `24` | `35` | `50` | `85` | `135` | `200` (mm)
- `horizon`: `0.0` - `1.0` (y of the horizon line)
- `dof`: `0.0` (everything sharp) - `1.0` (shallow depth of field, blurred background)
- `focusLayer`: optional; the `id` of the layer the camera focuses on (give that layer an `id` such as `"t_3"`)

### 4.2 Light (`light`)
- `key`: `"warm"` | `"cool"` | `"neutral"` | `"neon"` | `"fire"` | `"moon"`
- `time`: `"day"` | `"golden-hour"` | `"blue-hour"` | `"night"` | `"studio"` | `"overcast"`
- `azimuth`: `0` - `360` (light direction angle)
- `contrast`: `0.0` - `1.0` (shadow hardness)
- `rim`: `true` | `false` (rim light)

### 4.3 Style (`style`)
- `preset`:
  - General: `"cinematic-photo"`, `"hyper-real-photo"`, `"3d-render-cartoon"`, `"clay-3d"`, `"digital-painting"`, `"flat-vector"`, `"comic-ink"`, `"watercolor"`, `"low-poly"`, `"dark-documentary"`, `"retro-poster"`, `"neon-cyberpunk"`
  - Channel styles: `"hd2d-diorama"`, `"papercut-night"`, `"paper-hands"`, `"cutaway-architecture"`, `"spotlight-storybook"`, `"design-canvas"`
- `palette`: array of hex colours.
- Optional: `saturation` and `detail` (`0.0` - `1.0`), `mood` (e.g. `"dramatic"`), `custom` (free-text style note added to the prompt, in English).

### 4.4 Layer Types (`layers[].type`)
- `subject`: Character/person. Extra fields: `pose`, `expression`, `crop` (`"full"`|`"knee"`|`"waist"`|`"chest"`|`"head"`), `facing` (`"camera"`|`"left"`|`"right"`|`"away"`), `flip` (`true`|`false`), `importance` (1-3).
  - Poses (stored ids, write them exactly as shown): `"ayakta"` (standing), `"isaret-ediyor-sag"` (pointing right), `"isaret-ediyor-sol"` (pointing left), `"saskin-eller-yuzde"` (shocked, hands on face), `"dusunuyor-cene"` (thinking, hand on chin), `"kollar-kavusuk"` (arms crossed), `"kosuyor"` (running), `"oturuyor"` (sitting), `"comelmus"` (crouching), `"sirti-donuk"` (back turned), `"kollar-havada"` (arms raised), `"korkmus-geri-cekilen"` (scared, recoiling), `"bir-sey-tutuyor"` (holding something), `"fener-tutuyor"` (holding a lantern), `"dizustu-bakiyor"` (looking at a laptop), `"yuruyor"` (walking)
  - Expressions (stored ids): `"notr"` (neutral), `"saskin"` (surprised), `"korkmus"` (scared), `"gulen"` (smiling), `"ciddi"` (serious), `"kizgin"` (angry), `"supheci"` (suspicious), `"uzgun"` (sad), `"heyecanli"` (excited)
- `object`: Object. Extra fields: `shape` (`"rect"`|`"ellipse"`|`"triangle"`), `material`, `importance`.
- `background`: Background (only one, depth 100). Extra fields: `kind` (`"scene"`|`"gradient"`|`"solid"`|`"blur"`), `desc`.
- `text`: Title text. Extra fields: `content`, `font` (a font name: `"Impact"`|`"Arial Black"`|`"Segoe UI"`|`"Bahnschrift"`|`"Georgia"`|`"Cambria"`|`"Consolas"`, or a text preset id: `"youtube-bold"` (YouTube bold)|`"documentary-serif"` (documentary serif)|`"clean-minimal"` (clean minimal)|`"neon"`|`"label-box"` (label box)), `size` (ratio of the canvas height; shrinks automatically if it does not fit the text box), `fill`, `stroke`, `strokeW`, `shadow`, `align` (`left`|`center`|`right`), `uppercase`, `bg` (box colour behind the text, or `null`), `highlightWords` (words painted in the highlight colour), `highlight` (highlight colour, default `#ffd400`).
- `effect`: Emphasis effect. Extra fields: `kind` (`"arrow"`|`"circle"`|`"x-mark"`|`"check"`|`"glow"`|`"split"`|`"light-rays"`|`"badge"`), `stroke`, `fill`.
- `zone`: Negative empty space. Extra fields: `purpose` (`"title"`|`"face"`|`"empty"`).

Every layer may also have `name` (label shown in the editor), `desc` (what it shows), `id` and `color` (see section 6).

---

## 5. Full Example

```json
{
  "v": 1,
  "kind": "thumbstudio-template",
  "id": "reaction-face-title",
  "name": "Reaction face + big title",
  "desc": "A surprised face in close-up on the right, 2 lines of big text on the left, a blurred subject in the background.",
  "format": "16:9",
  "tags": ["face", "text", "classic"],
  "slots": {
    "TITLE": { "label": "Title (2-4 words)", "default": "HOW IS THIS POSSIBLE?" },
    "SUBJECT": { "label": "Subject in the background", "default": "an ancient temple" },
    "CHARACTER": { "label": "Person", "default": "a young explorer" }
  },
  "camera": {
    "shot": "close",
    "angle": "eye",
    "lens": 50,
    "horizon": 0.5,
    "dof": 0.7
  },
  "light": {
    "azimuth": 45,
    "key": "warm",
    "time": "golden-hour",
    "contrast": 0.7,
    "rim": true
  },
  "style": {
    "preset": "cinematic-photo",
    "palette": ["#1b2a3a", "#f08a3c", "#ffe9b0"]
  },
  "text": {
    "policy": "overlay",
    "reserve": true
  },
  "layers": [
    {
      "type": "background",
      "name": "Background",
      "kind": "scene",
      "desc": "{{SUBJECT}}, dramatic atmosphere, light fog",
      "depth": 100
    },
    {
      "type": "subject",
      "name": "Reaction character",
      "desc": "{{CHARACTER}}, looking at the camera in astonishment",
      "pose": "saskin-eller-yuzde",
      "expression": "saskin",
      "crop": "chest",
      "x": 0.55,
      "y": 0.08,
      "w": 0.42,
      "h": 0.92,
      "depth": 10,
      "importance": 3
    },
    {
      "type": "text",
      "name": "Main title",
      "content": "{{TITLE}}",
      "font": "Impact",
      "size": 0.16,
      "fill": "#ffffff",
      "stroke": "#000000",
      "strokeW": 0.06,
      "shadow": true,
      "uppercase": true,
      "x": 0.04,
      "y": 0.20,
      "w": 0.50,
      "h": 0.40,
      "depth": 0
    }
  ]
}
```

---

## 6. Missing Fields and What Is Sent to the AI

- If a layer has no `x/y/w/h`, `0.25 / 0.25 / 0.5 / 0.5` is used; `background` and `trace` are always full-frame (`0 / 0 / 1 / 1`). If `depth` is missing, it is 50.
- `color` is only the block colour in the editor and never goes into the prompt. If missing, a colour is assigned by type (person blue, object orange, text yellow…). The `layout.png` sent to the AI is drawn in neutral grey anyway (near is light, far is dark).
- The `desc` text goes into the prompt as is. The layer's position, size, plane (fore/mid/background) and the layers in front of/behind it are added to the prompt in words automatically; there is no need to repeat them in `desc`.
- `text` layers and the `arrow` / `circle` / `x-mark` / `check` / `badge` effects are not sent to the AI: they are overlaid with code in the final image. `glow`, `light-rays`, `split`, `blur-zone` and `vignette` are described in words in the prompt.
- A `zone` (empty space) appears in the prompt as "keep this area clean".
- When deriving a template from a sample thumbnail: place the large masses first (background, main person/object), then the text box, and the highlights last. Estimate the camera angle from the height of the horizon line and the slant of vertical lines. Turn every piece of text likely to change (subject, person, title) into a slot.
