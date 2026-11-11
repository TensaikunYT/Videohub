// Thumbnail Studio catalog: style presets, poses, camera, light, text presets (plain data).
// Shared by the browser UI and the server (server/thumbstudio/schema.js re-exports it), so no Node imports here.
// ---------- style presets (§5.4)
export const STYLE_PRESETS = [
  { id: 'cinematic-photo', name: 'Cinematic photo', prompt: 'cinematic photograph, dramatic lighting, film grain, 35mm film look', defaultPalette: ['#1b2a3a', '#f08a3c', '#ffe9b0'], suggestedLight: { key: 'warm', time: 'golden-hour', contrast: 0.7 } },
  { id: 'hyper-real-photo', name: 'Hyperrealistic photo', prompt: 'hyper-realistic photograph, sharp detail, natural lighting, DSLR quality', defaultPalette: ['#2c3e50', '#ecf0f1', '#e74c3c'], suggestedLight: { key: 'neutral', time: 'day', contrast: 0.5 } },
  { id: '3d-render-cartoon', name: '3D render (cartoon)', prompt: '3D rendered cartoon style, smooth surfaces, vibrant colors, stylized proportions', defaultPalette: ['#3498db', '#f1c40f', '#e74c3c'], suggestedLight: { key: 'neutral', time: 'studio', contrast: 0.4 } },
  { id: 'clay-3d', name: 'Clay 3D', prompt: 'clay render, soft matte material, miniature figurine, subtle shadows', defaultPalette: ['#d4c5a9', '#8d6e63', '#fff3e0'], suggestedLight: { key: 'warm', time: 'studio', contrast: 0.3 } },
  { id: 'digital-painting', name: 'Digital painting', prompt: 'digital painting, painterly brushstrokes, rich colors, concept art style', defaultPalette: ['#2c3e50', '#8e44ad', '#f39c12'], suggestedLight: { key: 'warm', time: 'golden-hour', contrast: 0.6 } },
  { id: 'flat-vector', name: 'Flat vector', prompt: 'flat vector illustration, clean shapes, bold colors, minimal shading', defaultPalette: ['#2c3e50', '#1abc9c', '#f1c40f'], suggestedLight: { key: 'neutral', time: 'day', contrast: 0.2 } },
  { id: 'comic-ink', name: 'Comic book ink', prompt: 'comic book ink style, bold outlines, halftone dots, dynamic composition', defaultPalette: ['#1a1a2e', '#e94560', '#f1c40f'], suggestedLight: { key: 'neutral', time: 'day', contrast: 0.8 } },
  { id: 'watercolor', name: 'Watercolor', prompt: 'watercolor painting, soft washes, paper texture, delicate color blending', defaultPalette: ['#a8d8ea', '#aa96da', '#fcbad3'], suggestedLight: { key: 'cool', time: 'overcast', contrast: 0.2 } },
  { id: 'low-poly', name: 'Low poly', prompt: 'low-poly 3D render, geometric facets, flat shading, modern minimal', defaultPalette: ['#2ecc71', '#3498db', '#e74c3c'], suggestedLight: { key: 'neutral', time: 'day', contrast: 0.4 } },
  { id: 'dark-documentary', name: 'Dark documentary', prompt: 'dark documentary style, moody, desaturated, gritty realism, available light', defaultPalette: ['#1a1a1a', '#4a4a4a', '#b0b0b0'], suggestedLight: { key: 'cool', time: 'blue-hour', contrast: 0.8 } },
  { id: 'retro-poster', name: 'Retro poster', prompt: 'retro vintage poster, limited color palette, screen-print texture, bold typography', defaultPalette: ['#c0392b', '#f39c12', '#ecf0f1'], suggestedLight: { key: 'warm', time: 'day', contrast: 0.5 } },
  { id: 'neon-cyberpunk', name: 'Neon cyberpunk', prompt: 'neon cyberpunk style, glowing lights, rain-wet reflections, dark urban, vibrant cyan and magenta', defaultPalette: ['#0d0d1a', '#00ffff', '#ff00ff'], suggestedLight: { key: 'neon', time: 'night', contrast: 0.9 } },
  // user's channel styles
  { id: 'hd2d-diorama', name: 'HD-2D diorama', prompt: 'tilt-shift miniature diorama, painted 3D figurines, warm lantern light', defaultPalette: ['#3e2723', '#ff8f00', '#fff8e1'], suggestedLight: { key: 'warm', time: 'golden-hour', contrast: 0.5 } },
  { id: 'papercut-night', name: 'Papercut night', prompt: 'layered cut-paper diorama under a night sky, rim-lit silhouettes', defaultPalette: ['#0d1b2a', '#1b4965', '#bee9e8'], suggestedLight: { key: 'moon', time: 'night', contrast: 0.6 } },
  { id: 'paper-hands', name: 'Paper Hands', prompt: 'warm paper texture, simple white cartoon hand', defaultPalette: ['#fff3e0', '#ffccbc', '#5d4037'], suggestedLight: { key: 'warm', time: 'studio', contrast: 0.3 } },
  { id: 'cutaway-architecture', name: 'Cutaway architecture', prompt: 'architectural cutaway cross-section, clean technical illustration', defaultPalette: ['#eceff1', '#546e7a', '#ff7043'], suggestedLight: { key: 'neutral', time: 'studio', contrast: 0.3 } },
  { id: 'spotlight-storybook', name: 'Spotlight storybook', prompt: 'flat stick-figure character in a lit painted 3D world', defaultPalette: ['#212121', '#fdd835', '#e8f5e9'], suggestedLight: { key: 'warm', time: 'golden-hour', contrast: 0.6 } },
  { id: 'design-canvas', name: 'Design canvas', prompt: 'premium editorial print-ad look, off-white stage, one hero object', defaultPalette: ['#fafafa', '#212121', '#ff5722'], suggestedLight: { key: 'neutral', time: 'studio', contrast: 0.4 } },
];

// ---------- poses (§5.1)
export const POSES = [
  { id: 'ayakta', name: 'Standing', promptEn: 'standing' },
  { id: 'isaret-ediyor-sag', name: 'Pointing (right)', promptEn: 'pointing with the right arm' },
  { id: 'isaret-ediyor-sol', name: 'Pointing (left)', promptEn: 'pointing with the left arm' },
  { id: 'saskin-eller-yuzde', name: 'Shocked (hands on cheeks)', promptEn: 'hands on cheeks in shock' },
  { id: 'dusunuyor-cene', name: 'Thinking (hand on chin)', promptEn: 'hand on chin, thinking' },
  { id: 'kollar-kavusuk', name: 'Arms crossed', promptEn: 'arms crossed' },
  { id: 'kosuyor', name: 'Running', promptEn: 'running' },
  { id: 'oturuyor', name: 'Sitting', promptEn: 'sitting' },
  { id: 'comelmus', name: 'Crouching', promptEn: 'crouching' },
  { id: 'sirti-donuk', name: 'Back to camera', promptEn: 'standing with back to the camera' },
  { id: 'kollar-havada', name: 'Arms raised (victory)', promptEn: 'both arms raised in victory' },
  { id: 'korkmus-geri-cekilen', name: 'Scared (recoiling)', promptEn: 'recoiling backwards in fear' },
  { id: 'bir-sey-tutuyor', name: 'Holding something', promptEn: 'holding something out with both hands' },
  { id: 'fener-tutuyor', name: 'Holding a flashlight', promptEn: 'holding up a flashlight' },
  { id: 'dizustu-bakiyor', name: 'Kneeling, looking down', promptEn: 'kneeling and looking down' },
  { id: 'yuruyor', name: 'Walking', promptEn: 'walking' },
];

// ---------- expressions (§5.2)
export const EXPRESSIONS = [
  { id: 'notr', name: 'Neutral', promptEn: 'neutral expression' },
  { id: 'saskin', name: 'Shocked', promptEn: 'wide-eyed shocked expression, mouth open' },
  { id: 'korkmus', name: 'Scared', promptEn: 'terrified expression, eyes wide with fear' },
  { id: 'gulen', name: 'Smiling', promptEn: 'big genuine smile, happy' },
  { id: 'ciddi', name: 'Serious', promptEn: 'serious stern expression' },
  { id: 'kizgin', name: 'Angry', promptEn: 'angry expression, furrowed brows' },
  { id: 'supheci', name: 'Skeptical', promptEn: 'skeptical expression, one eyebrow raised' },
  { id: 'uzgun', name: 'Sad', promptEn: 'sad expression, downcast eyes' },
  { id: 'heyecanli', name: 'Excited', promptEn: 'excited expression, wide eyes, open mouth smile' },
];

// ---------- camera angles (§5.3)
export const CAMERA_ANGLES = [
  { id: 'eye', name: 'Eye level', promptEn: 'eye-level shot', horizon: 0.5 },
  { id: 'low', name: 'Low angle', promptEn: 'low-angle shot looking up, subject feels powerful', horizon: 0.75 },
  { id: 'high', name: 'High angle', promptEn: 'high-angle shot looking down', horizon: 0.2 },
  { id: 'birds-eye', name: 'Bird’s-eye view', promptEn: "bird's-eye view, top-down", horizon: null },
  { id: 'worms-eye', name: 'Ground level (worm’s-eye view)', promptEn: 'extreme worm\'s-eye view from the ground', horizon: 0.92 },
  { id: 'overhead', name: 'Directly overhead', promptEn: 'directly overhead flat-lay', horizon: null },
  { id: 'dutch', name: 'Tilted (Dutch angle)', promptEn: 'dutch angle tilted {tilt} degrees', horizon: 0.5 },
];

// ---------- camera shots
export const CAMERA_SHOTS = [
  { id: 'extreme-close', name: 'Extreme close-up', promptEn: 'extreme close-up' },
  { id: 'close', name: 'Close-up', promptEn: 'close-up shot' },
  { id: 'medium', name: 'Medium shot', promptEn: 'medium shot' },
  { id: 'cowboy', name: 'Cowboy shot', promptEn: 'cowboy shot, framed from mid-thigh up' },
  { id: 'full', name: 'Full shot', promptEn: 'full shot, head to toe' },
  { id: 'wide', name: 'Wide shot', promptEn: 'wide establishing shot' },
  { id: 'extreme-wide', name: 'Extreme wide shot', promptEn: 'extreme wide shot, vast environment' },
];

// ---------- lenses
export const LENSES = [14, 24, 35, 50, 85, 135, 200];

// ---------- light keys
export const LIGHT_KEYS = [
  { id: 'warm', name: 'Warm' },
  { id: 'cool', name: 'Cool' },
  { id: 'neutral', name: 'Neutral' },
  { id: 'neon', name: 'Neon' },
  { id: 'fire', name: 'Fire' },
  { id: 'moon', name: 'Moon' },
];

// ---------- light times
export const LIGHT_TIMES = [
  { id: 'day', name: 'Daytime' },
  { id: 'golden-hour', name: 'Golden hour' },
  { id: 'blue-hour', name: 'Blue hour' },
  { id: 'night', name: 'Night' },
  { id: 'studio', name: 'Studio' },
  { id: 'overcast', name: 'Overcast' },
];

// ---------- text font presets (§5.5)
export const TEXT_PRESETS = [
  { id: 'youtube-bold', name: 'YouTube bold', font: 'Impact', fill: '#ffffff', stroke: '#000000', strokeW: 0.06, shadow: true, uppercase: true },
  { id: 'documentary-serif', name: 'Documentary serif', font: 'Georgia', fill: '#f5f5dc', stroke: '#1a1a1a', strokeW: 0.02, shadow: false, uppercase: false },
  { id: 'clean-minimal', name: 'Clean minimal', font: 'Segoe UI', fill: '#ffffff', stroke: null, strokeW: 0, shadow: true, uppercase: false },
  { id: 'neon', name: 'Neon', font: 'Arial Black', fill: '#00ffff', stroke: '#ff00ff', strokeW: 0.03, shadow: true, uppercase: true },
  { id: 'label-box', name: 'Label box', font: 'Bahnschrift', fill: '#ffffff', stroke: null, strokeW: 0, shadow: false, uppercase: true, bg: '#f08a3c' },
];

// ---------- effect kinds
export const EFFECT_KINDS = ['arrow', 'circle', 'x-mark', 'check', 'glow', 'split', 'light-rays', 'blur-zone', 'vignette', 'badge'];

// ---------- moods
export const MOODS = ['mysterious', 'epic', 'scary', 'funny', 'peaceful', 'dramatic', 'intense', 'nostalgic', 'curious', 'exciting'];

// ---------- full catalog (sent to UI)
export function catalog() {
  return {
    styles: STYLE_PRESETS,
    poses: POSES,
    expressions: EXPRESSIONS,
    angles: CAMERA_ANGLES,
    shots: CAMERA_SHOTS,
    lenses: LENSES,
    lightKeys: LIGHT_KEYS,
    lightTimes: LIGHT_TIMES,
    textPresets: TEXT_PRESETS,
    effectKinds: EFFECT_KINDS,
    moods: MOODS,
  };
}
