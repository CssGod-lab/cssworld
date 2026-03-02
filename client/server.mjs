#!/usr/bin/env node
/**
 * CssWorld Express Server
 * - Serves the frontend on port 8400
 * - Maintains world state in memory with JSON persistence
 * - WebSocket for real-time updates to browser
 * - REST API for advancing ticks, spawning, building, events
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '18802');
const STATE_FILE = path.join(__dirname, '..', 'world-state.json');
const GRID = 400;

// ===================== WORLD SIMULATION =====================

function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h = (h ^ (h >>> 16)) | 0;
  return h;
}

function noise2d(x, y, seed) {
  const dot = x * 12.9898 + y * 78.233 + seed * 43758.5453;
  const s = Math.sin(dot) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = noise2d(ix, iy, seed);
  const n10 = noise2d(ix + 1, iy, seed);
  const n01 = noise2d(ix, iy + 1, seed);
  const n11 = noise2d(ix + 1, iy + 1, seed);
  const nx0 = n00 * (1 - sx) + n10 * sx;
  const nx1 = n01 * (1 - sx) + n11 * sx;
  return nx0 * (1 - sy) + nx1 * sy;
}

function fbm(x, y, seed) {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 4; i++) {
    val += amp * smoothNoise(x * freq * 0.1, y * freq * 0.1, seed + i * 100);
    amp *= 0.5;
    freq *= 2;
  }
  return val;
}

// ===================== WORLD STATE =====================

let world = {
  worldState: { tick: 0, season: 'spring', timeOfDay: 'day', weather: 'clear', epoch: 0 },
  tiles: [],
  entities: [],
  structures: [],
  eventLog: [],
  nextEntityId: 1,
  nextStructureId: 1,
};

function initWorld() {
  const SEED = 42;
  world.tiles = [];
  world.entities = [];
  world.structures = [];
  world.eventLog = [];
  world.worldState = { tick: 0, season: 'spring', timeOfDay: 'day', weather: 'clear', epoch: 0 };
  world.nextEntityId = 1;
  world.nextStructureId = 1;

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const heightVal = fbm(x, y, SEED);
      const moistureVal = fbm(x, y, SEED + 500);
      const elevation = Math.floor(heightVal * 10);

      let terrain;
      if (heightVal < 0.25) terrain = 'water';
      else if (heightVal < 0.32) terrain = 'sand';
      else if (heightVal > 0.75) terrain = 'mountain';
      else if (heightVal > 0.65) terrain = 'rock';
      else if (moistureVal > 0.6) terrain = 'forest';
      else if (moistureVal > 0.5 && heightVal < 0.4) terrain = 'swamp';
      else terrain = 'grass';

      const resNoise = noise2d(x * 3.7, y * 2.3, SEED + 1000);
      let resource = 'none';
      if (resNoise > 0.85) {
        if (terrain === 'forest') resource = 'wood';
        else if (terrain === 'rock' || terrain === 'mountain') resource = 'stone';
        else if (terrain === 'grass') resource = 'herb';
        else if (terrain === 'swamp') resource = 'crystal';
      }

      let fertility = 50;
      if (terrain === 'grass') fertility = 70 + Math.floor(moistureVal * 30);
      else if (terrain === 'forest') fertility = 60 + Math.floor(moistureVal * 20);
      else if (terrain === 'water') fertility = 10;
      else if (terrain === 'sand') fertility = 15;
      else if (terrain === 'rock') fertility = 5;
      else if (terrain === 'mountain') fertility = 0;
      else if (terrain === 'swamp') fertility = 40;

      world.tiles.push({ x, y, terrain, elevation, resource, fertility });
    }
  }

  const initialEntities = [
    // Northern settlements
    { name: 'Aria the Wanderer', entityType: 'wanderer', x: 80, y: 60 },
    { name: 'Fern the Gatherer', entityType: 'gatherer', x: 120, y: 80 },
    { name: 'Lys the Herbalist', entityType: 'gatherer', x: 300, y: 70 },
    // Central heartland
    { name: 'Kael the Builder', entityType: 'builder', x: 200, y: 200 },
    { name: 'Dusk the Sentinel', entityType: 'guardian', x: 180, y: 220 },
    { name: 'Oren the Stonemason', entityType: 'builder', x: 220, y: 180 },
    // Eastern frontier
    { name: 'Mira the Seer', entityType: 'wanderer', x: 340, y: 160 },
    { name: 'Thane the Guardian', entityType: 'guardian', x: 320, y: 200 },
    // Southern expanse
    { name: 'Vesper the Drifter', entityType: 'wanderer', x: 100, y: 320 },
    { name: 'Rook the Warden', entityType: 'guardian', x: 200, y: 340 },
    { name: 'Sage the Forager', entityType: 'gatherer', x: 280, y: 300 },
    { name: 'Flint the Architect', entityType: 'builder', x: 160, y: 280 },
  ];

  for (const e of initialEntities) {
    world.entities.push({
      id: world.nextEntityId++,
      ...e,
      state: 'idle',
      hp: 100,
      energy: 100,
      inventory: {},
      direction: 'n',
      createdAt: 0,
    });
    addEvent(0, `${e.name} appeared at (${e.x}, ${e.y})`, 0, e.x, e.y, 'spawn');
  }

  addEvent(0, `World initialized: ${GRID}x${GRID} grid generated`, 0, 0, 0, 'discovery');
  saveState();
}

function addEvent(tick, message, entityId, x, y, eventType) {
  world.eventLog.push({ tick, message, entityId, x, y, eventType, createdAt: tick });
  // Keep last 500 events
  if (world.eventLog.length > 500) {
    world.eventLog = world.eventLog.slice(-500);
  }
}

function getTileAt(x, y) {
  if (x < 0 || x >= GRID || y < 0 || y >= GRID) return null;
  return world.tiles[y * GRID + x];
}

function advanceTick() {
  const ws = world.worldState;
  ws.tick++;
  const tick = ws.tick;

  const times = ['dawn', 'day', 'dusk', 'night'];
  const oldTime = ws.timeOfDay;
  ws.timeOfDay = times[Math.floor(tick / 24) % 4];

  const seasons = ['spring', 'summer', 'autumn', 'winter'];
  const oldSeason = ws.season;
  ws.season = seasons[Math.floor(tick / 96) % 4];

  const weatherRng = mulberry32(hashSeed(tick, 777, 0));
  const oldWeather = ws.weather;
  if (weatherRng() < 0.15) {
    const weathers = ['clear', 'rain', 'fog', 'storm'];
    ws.weather = weathers[Math.floor(weatherRng() * 4)];
  }

  ws.epoch = Math.floor(tick / 384);

  if (ws.timeOfDay !== oldTime) addEvent(tick, `Time changed to ${ws.timeOfDay}`, 0, 0, 0, 'weather');
  if (ws.season !== oldSeason) addEvent(tick, `Season changed to ${ws.season}`, 0, 0, 0, 'weather');
  if (ws.weather !== oldWeather) addEvent(tick, `Weather changed to ${ws.weather}`, 0, 0, 0, 'weather');

  const dirs = [
    { d: 'n', dx: 0, dy: -1 },
    { d: 's', dx: 0, dy: 1 },
    { d: 'e', dx: 1, dy: 0 },
    { d: 'w', dx: -1, dy: 0 },
  ];

  for (const ent of world.entities) {
    const rng = mulberry32(hashSeed(tick, ent.id, 42));

    if (ws.timeOfDay === 'night' && rng() < 0.6) {
      ent.state = 'sleeping';
      ent.energy = Math.min(100, ent.energy + 10);
    } else if (ent.energy < 20) {
      ent.state = 'idle';
      ent.energy = Math.min(100, ent.energy + 5);
    } else {
      const moveRoll = rng();
      if (moveRoll < 0.7) {
        const dirIdx = Math.floor(rng() * 4);
        const dir = dirs[dirIdx];
        const newX = Math.max(0, Math.min(GRID - 1, ent.x + dir.dx));
        const newY = Math.max(0, Math.min(GRID - 1, ent.y + dir.dy));

        const tile = getTileAt(newX, newY);
        let canMove = true;
        if (tile && tile.terrain === 'water' && ent.entityType !== 'wanderer') {
          canMove = false;
        }

        if (canMove && tile && ent.entityType === 'gatherer' && tile.resource !== 'none') {
          ent.state = 'gathering';
          ent.x = newX;
          ent.y = newY;
          ent.direction = dir.d;
          ent.energy = Math.max(0, ent.energy - 3);
          ent.inventory[tile.resource] = (ent.inventory[tile.resource] || 0) + 1;
          addEvent(tick, `${ent.name} gathered ${tile.resource} at (${newX}, ${newY})`, ent.id, newX, newY, 'gather');
        } else if (canMove) {
          ent.state = 'moving';
          ent.x = newX;
          ent.y = newY;
          ent.direction = dir.d;
          ent.energy = Math.max(0, ent.energy - 2);
          if (rng() < 0.1) {
            addEvent(tick, `${ent.name} moved ${dir.d} to (${newX}, ${newY})`, ent.id, newX, newY, 'move');
          }
        }
      } else {
        ent.state = 'idle';
      }
    }
  }

  // Decay structures
  world.structures = world.structures.filter(s => {
    s.durability--;
    if (s.durability <= 0) {
      addEvent(tick, `${s.structureType} at (${s.x}, ${s.y}) crumbled`, s.builderId, s.x, s.y, 'build');
      return false;
    }
    return true;
  });

  // Auto-save every 10 ticks
  if (tick % 10 === 0) saveState();

  return world;
}

function spawnEntity(name, entityType, x, y) {
  const ent = {
    id: world.nextEntityId++,
    name, entityType, x, y,
    state: 'idle', hp: 100, energy: 100,
    inventory: {}, direction: 'n',
    createdAt: world.worldState.tick,
  };
  world.entities.push(ent);
  addEvent(world.worldState.tick, `${name} (${entityType}) spawned at (${x}, ${y})`, ent.id, x, y, 'spawn');
  saveState();
  return ent;
}

function buildStructure(x, y, structureType, builderId) {
  const durabilities = { campfire: 50, tower: 200, bridge: 150, shrine: 300, wall: 250, garden: 80 };
  const s = {
    id: world.nextStructureId++,
    x, y, structureType, builderId,
    durability: durabilities[structureType] || 100,
    createdAt: world.worldState.tick,
  };
  world.structures.push(s);
  const builder = world.entities.find(e => e.id === builderId);
  const builderName = builder ? builder.name : `Entity #${builderId}`;
  addEvent(world.worldState.tick, `${builderName} built a ${structureType} at (${x}, ${y})`, builderId, x, y, 'build');
  saveState();
  return s;
}

function worldEvent(eventName) {
  const tick = world.worldState.tick;
  const rng = mulberry32(hashSeed(tick, 9999, eventName.length));

  if (eventName === 'meteor') {
    const mx = Math.floor(rng() * GRID);
    const my = Math.floor(rng() * GRID);
    for (const t of world.tiles) {
      const dx = Math.abs(t.x - mx);
      const dy = Math.abs(t.y - my);
      if (dx + dy <= 2) {
        t.terrain = 'rock';
        t.resource = 'stone';
        t.elevation = 8;
      }
    }
    addEvent(tick, `A meteor struck near (${mx}, ${my})!`, 0, mx, my, 'discovery');
  } else if (eventName === 'earthquake') {
    for (const t of world.tiles) {
      if (rng() < 0.15) {
        t.elevation = Math.max(0, Math.min(10, t.elevation + Math.floor(rng() * 5) - 2));
        if (t.elevation >= 8 && t.terrain !== 'water') t.terrain = 'mountain';
        else if (t.elevation <= 1 && t.terrain !== 'mountain') t.terrain = 'swamp';
      }
    }
    addEvent(tick, 'An earthquake shook the land!', 0, GRID/2, GRID/2, 'discovery');
  } else if (eventName === 'migration') {
    const types = ['wanderer', 'builder', 'gatherer', 'guardian'];
    const names = ['Nova', 'Elm', 'Sage', 'Flint', 'Coral'];
    for (let i = 0; i < 3; i++) {
      const etype = types[Math.floor(rng() * 4)];
      const ename = names[Math.floor(rng() * 5)] + ' the ' + etype.charAt(0).toUpperCase() + etype.slice(1);
      const ex = Math.floor(rng() * GRID);
      const ey = Math.floor(rng() * GRID);
      spawnEntity(ename, etype, ex, ey);
    }
  } else if (eventName === 'blessing') {
    for (const ent of world.entities) {
      ent.hp = 100;
      ent.energy = 100;
    }
    for (const t of world.tiles) {
      if (t.terrain === 'grass' || t.terrain === 'forest') {
        t.fertility = Math.min(100, t.fertility + 20);
      }
    }
    addEvent(tick, 'A divine blessing washed over the land!', 0, GRID/2, GRID/2, 'discovery');
  }
  saveState();
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(world));
  } catch (e) {
    console.error('Failed to save state:', e.message);
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      world = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      console.log(`Loaded world state: tick ${world.worldState.tick}, ${world.entities.length} entities`);
      return true;
    }
  } catch (e) {
    console.error('Failed to load state:', e.message);
  }
  return false;
}

// ===================== EXPRESS SERVER =====================

const app = express();
app.use(express.json());

// Serve static files
app.use('/sprites', express.static(path.join(__dirname, 'public', 'sprites')));
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API: Get dynamic state (no tiles - they're huge)
app.get('/api/state', (req, res) => {
  res.json({
    grid: GRID,
    worldState: world.worldState,
    entities: world.entities,
    structures: world.structures,
    eventLog: world.eventLog.slice(-50),
  });
});

// API: Get tiles (binary-packed for efficiency)
app.get('/api/tiles', (req, res) => {
  // Pack tiles as compact JSON array of arrays: [terrain_id, elevation, resource_id, fertility]
  const terrainMap = { water: 0, sand: 1, grass: 2, swamp: 3, forest: 4, rock: 5, mountain: 6 };
  const resourceMap = { none: 0, wood: 1, stone: 2, herb: 3, crystal: 4 };
  const packed = world.tiles.map(t => [
    terrainMap[t.terrain] ?? 2,
    t.elevation,
    resourceMap[t.resource] ?? 0,
    t.fertility
  ]);
  res.json({ grid: GRID, tiles: packed });
});

// API: Get summary (lightweight, for cron/agents)
app.get('/api/summary', (req, res) => {
  // Terrain census
  const terrain = {};
  for (const t of world.tiles) {
    terrain[t.terrain] = (terrain[t.terrain] || 0) + 1;
  }
  res.json({
    grid: GRID,
    worldState: world.worldState,
    entities: world.entities,
    structures: world.structures,
    terrain,
    eventLog: world.eventLog.slice(-30),
  });
});

// API: Advance tick
app.post('/api/tick', (req, res) => {
  advanceTick();
  broadcastState();
  res.json({ ok: true, tick: world.worldState.tick });
});

// API: Spawn entity
app.post('/api/spawn', (req, res) => {
  const { name, entityType, x, y } = req.body;
  if (!name || !entityType) return res.status(400).json({ error: 'name and entityType required' });
  const ent = spawnEntity(name, entityType, x ?? Math.floor(GRID/2), y ?? Math.floor(GRID/2));
  broadcastState();
  res.json({ ok: true, entity: ent });
});

// API: Build structure
app.post('/api/build', (req, res) => {
  const { x, y, structureType, builderId } = req.body;
  if (!structureType) return res.status(400).json({ error: 'structureType required' });
  const s = buildStructure(x || 0, y || 0, structureType, builderId || 0);
  broadcastState();
  res.json({ ok: true, structure: s });
});

// API: World event
app.post('/api/event', (req, res) => {
  const { eventName } = req.body;
  if (!eventName) return res.status(400).json({ error: 'eventName required' });
  worldEvent(eventName);
  broadcastState();
  res.json({ ok: true, event: eventName });
});

// API: Re-init world
app.post('/api/init', (req, res) => {
  initWorld();
  broadcastState();
  res.json({ ok: true });
});

// ===================== WEBSOCKET =====================

const server = createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  // Send dynamic state on connect (tiles fetched via REST)
  ws.send(JSON.stringify({
    type: 'state',
    data: {
      grid: GRID,
      worldState: world.worldState,
      entities: world.entities,
      structures: world.structures,
      eventLog: world.eventLog.slice(-50),
    }
  }));

  // Handle tile region requests from client
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'get-tiles-changed') {
        // Send tiles that changed since events (meteor/earthquake)
        // For now, send affected region
      }
    } catch(e) {}
  });

  ws.on('close', () => clients.delete(ws));
});

function broadcastState() {
  const msg = JSON.stringify({
    type: 'update',
    data: {
      worldState: world.worldState,
      entities: world.entities,
      structures: world.structures,
      eventLog: world.eventLog.slice(-50),
    }
  });
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// ===================== START =====================

if (!loadState()) {
  console.log('No saved state found, initializing new world...');
  initWorld();
}

server.listen(PORT, () => {
  console.log(`CssWorld server running at http://localhost:${PORT}`);
  console.log(`WebSocket on ws://localhost:${PORT}`);
  console.log(`World: tick ${world.worldState.tick}, ${world.entities.length} entities, ${world.tiles.length} tiles`);
});
