#!/usr/bin/env node
/**
 * Generate all sprites for CssWorld using the Retro Diffusion API.
 * Saves 64x64 pixel art PNGs to cssworld/client/public/sprites/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPRITES_DIR = path.join(__dirname, '..', 'client', 'public', 'sprites');
const KEY_FILE = path.join(__dirname, '..', '..', '.wallet', 'retrodiffusion-key.txt');

const API_URL = 'https://api.retrodiffusion.ai/v1/inferences';
const API_KEY = fs.readFileSync(KEY_FILE, 'utf-8').trim();

const sprites = [
  // Terrain (7)
  { name: 'grass', prompt: 'top-down pixel art grass terrain tile, green, game asset, 16-bit style' },
  { name: 'water', prompt: 'top-down pixel art water terrain tile, blue ocean, game asset, 16-bit style' },
  { name: 'sand', prompt: 'top-down pixel art sand desert terrain tile, game asset, 16-bit style' },
  { name: 'rock', prompt: 'top-down pixel art rocky terrain tile, gray stone, game asset, 16-bit style' },
  { name: 'forest', prompt: 'top-down pixel art forest terrain tile with trees, game asset, 16-bit style' },
  { name: 'mountain', prompt: 'top-down pixel art mountain terrain tile, snowy peak, game asset, 16-bit style' },
  { name: 'swamp', prompt: 'top-down pixel art swamp terrain tile, murky green, game asset, 16-bit style' },
  // Entities (4)
  { name: 'wanderer', prompt: 'top-down pixel art wanderer character sprite, hooded figure, game asset, 16-bit' },
  { name: 'builder', prompt: 'top-down pixel art builder character sprite, hammer tool, game asset, 16-bit' },
  { name: 'gatherer', prompt: 'top-down pixel art gatherer character sprite, basket, game asset, 16-bit' },
  { name: 'guardian', prompt: 'top-down pixel art guardian character sprite, shield armor, game asset, 16-bit' },
  // Structures (6)
  { name: 'campfire', prompt: 'top-down pixel art campfire, warm glow, game asset, 16-bit style' },
  { name: 'tower', prompt: 'top-down pixel art stone tower structure, game asset, 16-bit style' },
  { name: 'bridge', prompt: 'top-down pixel art wooden bridge, game asset, 16-bit style' },
  { name: 'shrine', prompt: 'top-down pixel art mystical shrine with glow, game asset, 16-bit style' },
  { name: 'wall', prompt: 'top-down pixel art stone wall section, game asset, 16-bit style' },
  { name: 'garden', prompt: 'top-down pixel art garden with flowers, game asset, 16-bit style' },
];

fs.mkdirSync(SPRITES_DIR, { recursive: true });

async function generateSprite(sprite) {
  const outPath = path.join(SPRITES_DIR, `${sprite.name}.png`);
  
  // Skip if already exists
  if (fs.existsSync(outPath)) {
    console.log(`✓ ${sprite.name}.png already exists, skipping`);
    return true;
  }
  
  console.log(`Generating ${sprite.name}.png...`);
  
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'X-RD-Token': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: sprite.prompt,
        width: 64,
        height: 64,
        num_images: 1,
      }),
    });
    
    if (!res.ok) {
      const text = await res.text();
      console.error(`✗ ${sprite.name}: HTTP ${res.status} - ${text}`);
      return false;
    }
    
    const data = await res.json();
    if (!data.base64_images || !data.base64_images[0]) {
      console.error(`✗ ${sprite.name}: No image in response`);
      return false;
    }
    
    const buffer = Buffer.from(data.base64_images[0], 'base64');
    fs.writeFileSync(outPath, buffer);
    console.log(`✓ ${sprite.name}.png (${buffer.length} bytes, cost: ${data.credit_cost || '?'})`);
    return true;
  } catch (err) {
    console.error(`✗ ${sprite.name}: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log(`Generating ${sprites.length} sprites to ${SPRITES_DIR}`);
  console.log(`API Key: ${API_KEY.slice(0, 8)}...`);
  console.log('');
  
  let success = 0;
  let fail = 0;
  
  // Sequential to avoid rate limiting
  for (const sprite of sprites) {
    const ok = await generateSprite(sprite);
    if (ok) success++; else fail++;
    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log('');
  console.log(`Done: ${success} succeeded, ${fail} failed`);
}

main().catch(console.error);
