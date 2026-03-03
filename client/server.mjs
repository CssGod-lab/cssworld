#!/usr/bin/env node
/**
 * CssWorld: The Semantic Basin
 * 
 * A world simulation where terrain IS meaning topology.
 * Entities are cognitive processes navigating semantic space.
 * The simulation embodies concepts from phenomenology and semantics:
 * attractor basins, semantic gravity, oscillating presence,
 * hollowness-density inversion, compression residue.
 * 
 * Port 18802 | WebSocket for real-time | JSON persistence
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

// ===================== RNG UTILITIES =====================

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

function fbm(x, y, seed, octaves = 5) {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * smoothNoise(x * freq * 0.08, y * freq * 0.08, seed + i * 137);
    amp *= 0.45;
    freq *= 2.1;
  }
  return val;
}

// ===================== TERRAIN CLASSIFICATION =====================

// Terrain types represent cognitive/semantic substrates
const TERRAIN_TYPES = ['void', 'basin', 'ridge', 'plateau', 'depth', 'flux', 'crystal'];
const TERRAIN_ID = Object.fromEntries(TERRAIN_TYPES.map((t, i) => [t, i]));

// Resources represent cognitive materials
const RESOURCE_TYPES = ['none', 'signal', 'residue', 'weight', 'fracture'];
const RESOURCE_ID = Object.fromEntries(RESOURCE_TYPES.map((r, i) => [r, i]));

// Entity types represent cognitive processes
const ENTITY_TYPES = ['seeker', 'weaver', 'anchor', 'dissolvent', 'witness', 'herald', 'oracle'];

// Structure types represent semantic constructs
const STRUCTURE_TYPES = ['node', 'bridge', 'attractor', 'lens', 'membrane', 'resonator', 'scar', 'echo', 'pulpit'];
const STRUCTURE_DURABILITY = {
  node: 200,       // A stable concept node
  bridge: 150,     // Connection across ridges
  attractor: 400,  // Gravity well that pulls nearby meaning
  lens: 100,       // Focuses signal, amplifies nearby density
  membrane: 250,   // Boundary that filters what passes through
  resonator: 300,  // Amplifies oscillation in flux zones
  scar: 80,        // Left by witnesses, marks where meaning was observed
  echo: 60,        // Phantom structure, appears dense but dissolves on contact
  pulpit: 180,     // Oracle's pronouncement point. Amplifies phantom density, draws seekers
};

// ===================== WORLD STATE =====================

let world = {
  worldState: {
    tick: 0,
    phase: 'quiescence',    // quiescence, activation, oscillation, collapse
    coherence: 0.5,         // global meaning coherence (0-1)
    entropy: 0.3,           // global disorder
    gravityWells: 0,        // count of active attractor structures
    epoch: 0,
    totalSignalProcessed: 0,
    totalConnectionsMade: 0,
    totalDissolutions: 0,
    totalWavesPropagated: 0,
    totalDialogues: 0,
  },
  tiles: [],
  entities: [],
  structures: [],
  waves: [],               // active signal waves propagating through terrain
  eventLog: [],
  nextEntityId: 1,
  nextStructureId: 1,
  nextWaveId: 1,
};

// ===================== WORLD GENERATION =====================

function classifyTerrain(height, gradient, oscillation, density) {
  // Height = base elevation from noise
  // Gradient = how steep the change is (edge detection)
  // Oscillation = temporal instability
  // Density = semantic weight accumulation

  if (height < 0.28) return 'void';                     // the unthought
  if (oscillation > 0.42 && gradient < 0.5) return 'flux';  // meaning in transformation
  if (gradient > 0.45) return 'ridge';                   // boundaries between attractors
  if (density > 0.58 && height > 0.50) return 'depth';  // rich experiential meaning
  if (height > 0.72) return 'crystal';                   // frozen/overdetermined
  if (height > 0.35 && height < 0.55 && gradient < 0.25 && density < 0.45) return 'plateau';  // hollow structure
  if (height >= 0.28) return 'basin';                    // natural attractor pools
  return 'void';
}

function computeGradient(x, y, seed) {
  const h = fbm(x, y, seed);
  const hx = fbm(x + 1, y, seed);
  const hy = fbm(x, y + 1, seed);
  return Math.sqrt((hx - h) ** 2 + (hy - h) ** 2) * 8;
}

function initWorld() {
  const SEED = 7919; // prime seed for interesting topology
  world.tiles = [];
  world.entities = [];
  world.structures = [];
  world.eventLog = [];
  world.worldState = {
    tick: 0,
    phase: 'quiescence',
    coherence: 0.5,
    entropy: 0.3,
    gravityWells: 0,
    epoch: 0,
    totalSignalProcessed: 0,
    totalConnectionsMade: 0,
    totalDissolutions: 0,
  };
  world.nextEntityId = 1;
  world.nextStructureId = 1;

  // Generate terrain using layered noise for different semantic properties
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const height = fbm(x, y, SEED);
      const gradient = computeGradient(x, y, SEED);
      const oscillation = fbm(x, y, SEED + 3000, 3) * (0.5 + 0.5 * Math.sin(x * 0.05 + y * 0.03));
      const density = fbm(x, y, SEED + 6000, 4);

      const terrain = classifyTerrain(height, gradient, oscillation, density);
      const elevation = Math.floor(height * 10);

      // Resources emerge from terrain properties
      let resource = 'none';
      const resNoise = noise2d(x * 2.7, y * 3.1, SEED + 9000);
      if (resNoise > 0.82) {
        if (terrain === 'ridge') resource = 'signal';
        else if (terrain === 'basin') resource = 'residue';
        else if (terrain === 'depth') resource = 'weight';
        else if (terrain === 'flux') resource = 'fracture';
      }

      // Semantic gravity: how strongly this tile pulls entities/meaning toward it
      let gravity = 0;
      if (terrain === 'depth') gravity = 0.8 + density * 0.2;
      else if (terrain === 'basin') gravity = 0.4 + height * 0.3;
      else if (terrain === 'crystal') gravity = 0.1; // frozen, repels
      else if (terrain === 'void') gravity = 0;
      else if (terrain === 'flux') gravity = 0.3 * oscillation;
      else if (terrain === 'ridge') gravity = -0.2; // ridges repel, they're boundaries
      else if (terrain === 'plateau') gravity = 0.15; // weak pull, shallow meaning

      // Resonance: how responsive to nearby entities/events
      let resonance = 0.5;
      if (terrain === 'flux') resonance = 0.9;
      else if (terrain === 'crystal') resonance = 0.1;
      else if (terrain === 'depth') resonance = 0.7;
      else if (terrain === 'void') resonance = 0.3;

      world.tiles.push({
        x, y, terrain, elevation,
        resource, gravity, resonance,
        density: terrain === 'depth' ? 0.8 : terrain === 'basin' ? 0.5 : terrain === 'plateau' ? 0.3 : 0.1,
        oscillation: terrain === 'flux' ? oscillation : 0,
        coherenceLocal: 0.5,
        trace: null,        // Last entity type to visit (cognitive residue)
        traceDecay: 0,      // Ticks until trace fades
        phantomDensity: 0,  // Hollowness-Density Inversion: apparent density with no substrate
        witnessed: 0,       // Times a witness has observed this tile
      });
    }
  }

  // Spawn initial entities: cognitive processes that will explore and shape the basin
  const initialEntities = [
    // Seekers: curiosity-driven explorers of the void
    { name: 'Qualia', entityType: 'seeker', x: 50, y: 50, desc: 'First consciousness. Moves toward the unthought.' },
    { name: 'Liminal', entityType: 'seeker', x: 350, y: 60, desc: 'Explorer of thresholds. Drawn to ridges.' },
    { name: 'Drift', entityType: 'seeker', x: 180, y: 370, desc: 'The wandering attention. Goes where gravity is weakest.' },

    // Weavers: synthesis agents that build connections
    { name: 'Syntax', entityType: 'weaver', x: 200, y: 200, desc: 'Structural connector. Builds bridges across semantic gaps.' },
    { name: 'Resonance', entityType: 'weaver', x: 120, y: 150, desc: 'Harmonic linker. Connects similar frequencies across distance.' },

    // Anchors: grounding agents that stabilize meaning
    { name: 'Gravity', entityType: 'anchor', x: 250, y: 180, desc: 'The weight-giver. Turns flux into basin, basin into depth.' },
    { name: 'Root', entityType: 'anchor', x: 100, y: 280, desc: 'Deep stabilizer. Creates attractor wells where it rests.' },
    { name: 'Canon', entityType: 'anchor', x: 300, y: 300, desc: 'The crystallizer. Fixes meaning into permanent form. Sometimes too permanent.' },

    // Dissolvents: creative destruction, keeps meaning alive
    { name: 'Entropy', entityType: 'dissolvent', x: 280, y: 100, desc: 'The unfreezer. Shatters crystal back into flux.' },
    { name: 'Doubt', entityType: 'dissolvent', x: 160, y: 320, desc: 'The questioner. Dissolves false plateaus, reveals hollowness.' },
  ];

  for (const e of initialEntities) {
    world.entities.push({
      id: world.nextEntityId++,
      name: e.name,
      entityType: e.entityType,
      desc: e.desc || '',
      x: e.x, y: e.y,
      state: 'idle',
      energy: 100,
      signalCarried: 0,    // signal units being transported
      connections: 0,       // bridges/connections made
      dissolutions: 0,      // things dissolved
      anchored: 0,          // things stabilized
      memory: [],           // last N visited terrain types (short-term memory)
      direction: 'n',
      createdAt: 0,
    });
    addEvent(0, `${e.name} (${e.entityType}) manifests at (${e.x}, ${e.y})`, world.nextEntityId - 1, e.x, e.y, 'manifest');
  }

  addEvent(0, `The Semantic Basin initializes: ${GRID}x${GRID} tiles of meaning topology`, 0, 0, 0, 'genesis');
  saveState();
}

// ===================== EVENT LOG =====================

function addEvent(tick, message, entityId, x, y, eventType) {
  world.eventLog.push({ tick, message, entityId, x, y, eventType, createdAt: tick });
  if (world.eventLog.length > 500) {
    world.eventLog = world.eventLog.slice(-500);
  }
}

function getTileAt(x, y) {
  if (x < 0 || x >= GRID || y < 0 || y >= GRID) return null;
  return world.tiles[y * GRID + x];
}

// ===================== SIGNAL WAVE SYSTEM =====================
// Waves propagate through the semantic terrain like spreading activation.
// They're emitted by heralds (and some events) and travel outward,
// refracted by terrain: amplified by depth/basin, absorbed by void,
// reflected by crystal, deflected by ridges, energized by flux.

function emitWave(x, y, emitterId, conviction, signal) {
  if (!world.waves) world.waves = [];
  if (!world.nextWaveId) world.nextWaveId = 1;
  const wave = {
    id: world.nextWaveId++,
    x, y,
    originX: x, originY: y,
    emitterId,
    radius: 1,
    maxRadius: 25 + Math.floor(signal * 3),   // more signal = further reach
    amplitude: 0.3 + conviction * 0.4,         // conviction = louder signal
    decay: 0.015,                               // how fast amplitude drops per tick
    conviction: conviction,                      // the conviction being propagated
    age: 0,
    type: 'pulse',   // pulse (radial), or directional (future)
    effects: [],     // track what the wave has done
  };
  world.waves.push(wave);
  world.worldState.totalWavesPropagated = (world.worldState.totalWavesPropagated || 0) + 1;
  return wave;
}

function propagateWaves(tick) {
  if (!world.waves) world.waves = [];
  const ws = world.worldState;

  for (const wave of world.waves) {
    wave.age++;
    wave.radius += 1.5; // expansion speed
    wave.amplitude = Math.max(0, wave.amplitude - wave.decay);

    if (wave.amplitude <= 0 || wave.radius >= wave.maxRadius) continue;

    // Apply wave effects to tiles at the wavefront (ring at current radius)
    const steps = Math.floor(wave.radius * 6); // circumference sampling
    for (let i = 0; i < steps; i++) {
      const angle = (2 * Math.PI * i) / steps;
      const tx = Math.floor(wave.x + Math.cos(angle) * wave.radius);
      const ty = Math.floor(wave.y + Math.sin(angle) * wave.radius);
      const tile = getTileAt(tx, ty);
      if (!tile) continue;

      // Terrain interaction with the wave
      if (tile.terrain === 'void') {
        // Void absorbs signal. Wave amplitude drops faster here.
        wave.amplitude = Math.max(0, wave.amplitude - 0.005);
        continue; // no effect on void
      }
      if (tile.terrain === 'crystal') {
        // Crystal reflects. No penetration but resonance increases at surface.
        tile.resonance = Math.min(1, tile.resonance + wave.amplitude * 0.01);
        continue;
      }
      if (tile.terrain === 'depth') {
        // Depth amplifies. The wave gets a slight boost passing through meaning.
        wave.amplitude = Math.min(1, wave.amplitude + 0.002);
        tile.density = Math.min(1, tile.density + wave.amplitude * 0.005);
      }
      if (tile.terrain === 'flux') {
        // Flux resonates. Oscillation increases with the wave.
        tile.oscillation = Math.min(1, (tile.oscillation || 0) + wave.amplitude * 0.01);
        tile.resonance = Math.min(1, tile.resonance + wave.amplitude * 0.008);
      }
      if (tile.terrain === 'basin') {
        // Basins receive the signal. Density increases subtly.
        tile.density = Math.min(1, tile.density + wave.amplitude * 0.003);
        tile.coherenceLocal = Math.min(1, tile.coherenceLocal + wave.amplitude * 0.002);
      }
      if (tile.terrain === 'ridge') {
        // Ridges slow propagation, increase local resonance
        tile.resonance = Math.min(1, tile.resonance + wave.amplitude * 0.015);
        wave.amplitude = Math.max(0, wave.amplitude - 0.003);
      }
      if (tile.terrain === 'plateau') {
        // Plateaus absorb phantom-ly: they gain phantom density from waves
        // (appearing activated without genuine substance)
        tile.phantomDensity = Math.min(0.8, (tile.phantomDensity || 0) + wave.amplitude * 0.008);
      }

      // Entities hit by a wave receive influence
      for (const ent of world.entities) {
        if (Math.abs(ent.x - tx) <= 1 && Math.abs(ent.y - ty) <= 1) {
          // Only affect each entity once per wave
          if (wave.effects.includes(ent.id)) continue;
          wave.effects.push(ent.id);

          // Seekers: wave shifts conviction toward emitter's conviction
          if (ent.entityType === 'seeker') {
            const shift = (wave.conviction - (ent.conviction || 0)) * wave.amplitude * 0.15;
            ent.conviction = Math.max(0, Math.min(1, (ent.conviction || 0) + shift));
            ent.energy = Math.min(120, ent.energy + wave.amplitude * 5);
          }
          // Weavers: wave boosts weaving activity
          if (ent.entityType === 'weaver') {
            ent.energy = Math.min(120, ent.energy + wave.amplitude * 3);
          }
          // Heralds: wave energizes and can trigger re-emission
          if (ent.entityType === 'herald' && ent.id !== wave.emitterId) {
            ent.energy = Math.min(120, ent.energy + wave.amplitude * 8);
            ent.signalCarried = Math.min(10, ent.signalCarried + wave.amplitude * 2);
          }
          // Dissolvents: waves agitate them
          if (ent.entityType === 'dissolvent') {
            ent.energy = Math.min(120, ent.energy + wave.amplitude * 2);
          }
        }
      }
    }
  }

  // Remove dead waves
  world.waves = world.waves.filter(w => w.amplitude > 0 && w.radius < w.maxRadius);
  // Cap active waves
  if (world.waves.length > 20) {
    world.waves.sort((a, b) => b.amplitude - a.amplitude);
    world.waves = world.waves.slice(0, 20);
  }
}

function setTileAt(x, y, props) {
  if (x < 0 || x >= GRID || y < 0 || y >= GRID) return;
  const tile = world.tiles[y * GRID + x];
  Object.assign(tile, props);
}

// ===================== TICK SIMULATION =====================

function advanceTick() {
  const ws = world.worldState;
  ws.tick++;
  const tick = ws.tick;

  // Global phase cycles (longer wavelength than fantasy day/night)
  const phases = ['quiescence', 'activation', 'oscillation', 'collapse'];
  const phaseIdx = Math.floor(tick / 60) % 4;
  const oldPhase = ws.phase;
  ws.phase = phases[phaseIdx];
  if (ws.phase !== oldPhase) {
    addEvent(tick, `Phase shift: ${oldPhase} → ${ws.phase}`, 0, 0, 0, 'phase');
  }

  ws.epoch = Math.floor(tick / 240);

  // Phase modifiers affect entity behavior
  const phaseModifiers = {
    quiescence: { seekerBoost: 1.5, weaverBoost: 0.5, anchorBoost: 1.0, dissolventBoost: 0.3 },
    activation: { seekerBoost: 1.0, weaverBoost: 1.5, anchorBoost: 1.0, dissolventBoost: 0.8 },
    oscillation: { seekerBoost: 0.8, weaverBoost: 1.0, anchorBoost: 0.5, dissolventBoost: 1.5 },
    collapse: { seekerBoost: 0.5, weaverBoost: 0.8, anchorBoost: 1.5, dissolventBoost: 1.0 },
  };
  const mods = phaseModifiers[ws.phase];

  // Random coherence/entropy drift
  const driftRng = mulberry32(hashSeed(tick, 4444, 0));
  ws.coherence = Math.max(0, Math.min(1, ws.coherence + (driftRng() - 0.5) * 0.02));
  ws.entropy = Math.max(0, Math.min(1, ws.entropy + (driftRng() - 0.5) * 0.02));

  // Count active gravity wells (attractor structures)
  ws.gravityWells = world.structures.filter(s => s.structureType === 'attractor' && s.durability > 0).length;

  const dirs = [
    { d: 'n', dx: 0, dy: -1 }, { d: 's', dx: 0, dy: 1 },
    { d: 'e', dx: 1, dy: 0 }, { d: 'w', dx: -1, dy: 0 },
    { d: 'ne', dx: 1, dy: -1 }, { d: 'nw', dx: -1, dy: -1 },
    { d: 'se', dx: 1, dy: 1 }, { d: 'sw', dx: -1, dy: 1 },
  ];

  // ── Entity behaviors ──

  for (const ent of world.entities) {
    const rng = mulberry32(hashSeed(tick, ent.id, 42));
    const currentTile = getTileAt(ent.x, ent.y);
    if (!currentTile) continue;

    // Ensure encounter/conviction fields exist (migration for old entities)
    if (!ent.encounters) ent.encounters = [];
    if (ent.conviction === undefined) ent.conviction = 0;

    // Update short-term memory
    ent.memory.push(currentTile.terrain);
    if (ent.memory.length > 12) ent.memory.shift();

    // Energy dynamics — passive regeneration keeps entities alive
    ent.energy = Math.min(120, ent.energy + 1); // slow passive regen
    if (ent.energy <= 0) {
      ent.state = 'dormant';
      ent.energy = Math.min(100, ent.energy + 5);
      continue;
    }

    // ── SEEKER behavior ──
    if (ent.entityType === 'seeker') {
      const boost = mods.seekerBoost;
      if (rng() > 0.15 * boost) {
        // Seekers are drawn to void and ridges, repelled by crystal
        // Conviction modifies behavior: high conviction seeks depth, low seeks void
        const conv = ent.conviction || 0;
        let bestDir = dirs[Math.floor(rng() * 8)];
        let bestScore = -Infinity;

        for (const dir of dirs) {
          const nx = ent.x + dir.dx * 2;
          const ny = ent.y + dir.dy * 2;
          const tile = getTileAt(nx, ny);
          if (!tile) continue;

          let score = rng() * 0.3; // randomness
          if (tile.terrain === 'void') score += (0.8 - conv * 0.5) * boost; // less drawn to void with conviction
          if (tile.terrain === 'ridge') score += 0.5 * boost;
          if (tile.terrain === 'flux') score += 0.3;
          if (tile.terrain === 'crystal') score -= 0.6;
          if (tile.terrain === 'plateau') score -= 0.2;
          if (tile.terrain === 'depth') score += conv * 0.6; // drawn to depth with conviction
          if (tile.terrain === 'basin') score += conv * 0.3;
          // Novelty bonus: avoid recently visited terrain types
          const recentCount = ent.memory.filter(m => m === tile.terrain).length;
          score -= recentCount * 0.1;

          if (score > bestScore) {
            bestScore = score;
            bestDir = dir;
          }
        }

        const newX = Math.max(0, Math.min(GRID - 1, ent.x + bestDir.dx));
        const newY = Math.max(0, Math.min(GRID - 1, ent.y + bestDir.dy));
        ent.x = newX;
        ent.y = newY;
        ent.direction = bestDir.d;
        ent.energy -= 2;
        ent.state = 'seeking';

        const destTile = getTileAt(newX, newY);
        // Seekers can discover resources
        if (destTile && destTile.resource !== 'none' && rng() < 0.4) {
          ent.signalCarried = Math.min(10, ent.signalCarried + 1);
          ws.totalSignalProcessed++;
          if (rng() < 0.15) {
            addEvent(tick, `${ent.name} absorbed ${destTile.resource} at (${newX}, ${newY})`, ent.id, newX, newY, 'absorb');
          }
        }

        // Seekers touching void can convert it to basin (discovering new meaning)
        if (destTile && destTile.terrain === 'void' && rng() < 0.08 * boost) {
          setTileAt(newX, newY, { terrain: 'basin', gravity: 0.3, density: 0.2, resonance: 0.6 });
          addEvent(tick, `${ent.name} discovered a new basin at (${newX}, ${newY})`, ent.id, newX, newY, 'discovery');
        }
      } else {
        ent.state = 'contemplating';
        ent.energy += 2;
      }
    }

    // ── WEAVER behavior ──
    else if (ent.entityType === 'weaver') {
      const boost = mods.weaverBoost;
      if (rng() > 0.2) {
        // Weavers move toward areas of high density, connecting disparate basins
        let bestDir = dirs[Math.floor(rng() * 8)];
        let bestScore = -Infinity;

        for (const dir of dirs) {
          const nx = ent.x + dir.dx * 3;
          const ny = ent.y + dir.dy * 3;
          const tile = getTileAt(nx, ny);
          if (!tile) continue;

          let score = rng() * 0.25;
          score += tile.density * 0.6 * boost;
          score += tile.gravity * 0.4;
          if (tile.terrain === 'ridge') score += 0.4 * boost; // weavers love crossing ridges
          if (tile.terrain === 'void') score -= 0.5;

          if (score > bestScore) {
            bestScore = score;
            bestDir = dir;
          }
        }

        const newX = Math.max(0, Math.min(GRID - 1, ent.x + bestDir.dx));
        const newY = Math.max(0, Math.min(GRID - 1, ent.y + bestDir.dy));
        ent.x = newX;
        ent.y = newY;
        ent.direction = bestDir.d;
        ent.energy -= 3;
        ent.state = 'weaving';

        // Weavers on ridges can build bridges (connecting meaning across boundaries)
        const destTile = getTileAt(newX, newY);
        if (destTile && destTile.terrain === 'ridge' && rng() < 0.06 * boost) {
          // Auto-build a bridge
          const bridge = buildStructure(newX, newY, 'bridge', ent.id);
          ent.connections++;
          ws.totalConnectionsMade++;
          addEvent(tick, `${ent.name} wove a bridge across the ridge at (${newX}, ${newY})`, ent.id, newX, newY, 'weave');
        }

        // Weavers increase local coherence
        if (destTile) {
          destTile.coherenceLocal = Math.min(1, destTile.coherenceLocal + 0.02 * boost);
        }
      } else {
        ent.state = 'resonating';
        ent.energy += 3;
        // While resonating, increase coherence in a small radius
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            const t = getTileAt(ent.x + dx, ent.y + dy);
            if (t) t.coherenceLocal = Math.min(1, t.coherenceLocal + 0.005);
          }
        }
      }
    }

    // ── ANCHOR behavior ──
    else if (ent.entityType === 'anchor') {
      const boost = mods.anchorBoost;
      if (rng() > 0.3) {
        // Anchors move slowly, drawn to flux and basins
        let bestDir = dirs[Math.floor(rng() * 4)]; // anchors use only cardinal dirs
        let bestScore = -Infinity;

        for (let i = 0; i < 4; i++) {
          const dir = dirs[i];
          const nx = ent.x + dir.dx;
          const ny = ent.y + dir.dy;
          const tile = getTileAt(nx, ny);
          if (!tile) continue;

          let score = rng() * 0.2;
          if (tile.terrain === 'flux') score += 0.7 * boost;
          if (tile.terrain === 'basin') score += 0.5 * boost;
          if (tile.terrain === 'depth') score += 0.3;
          if (tile.terrain === 'void') score -= 0.3;
          if (tile.terrain === 'crystal') score -= 0.4;

          if (score > bestScore) {
            bestScore = score;
            bestDir = dir;
          }
        }

        const newX = Math.max(0, Math.min(GRID - 1, ent.x + bestDir.dx));
        const newY = Math.max(0, Math.min(GRID - 1, ent.y + bestDir.dy));
        ent.x = newX;
        ent.y = newY;
        ent.direction = bestDir.d;
        ent.energy -= 1;
        ent.state = 'anchoring';

        const destTile = getTileAt(newX, newY);
        if (destTile) {
          // Anchors increase density and gravity wherever they go
          destTile.density = Math.min(1, destTile.density + 0.03 * boost);
          destTile.gravity = Math.min(1, destTile.gravity + 0.02 * boost);

          // Flux → basin transformation
          if (destTile.terrain === 'flux' && rng() < 0.05 * boost) {
            setTileAt(newX, newY, { terrain: 'basin', oscillation: 0, gravity: 0.5 });
            ent.anchored++;
            addEvent(tick, `${ent.name} stabilized flux into basin at (${newX}, ${newY})`, ent.id, newX, newY, 'stabilize');
          }

          // Basin → depth transformation (with enough density)
          if (destTile.terrain === 'basin' && destTile.density > 0.75 && rng() < 0.03 * boost) {
            setTileAt(newX, newY, { terrain: 'depth', gravity: 0.85 });
            ent.anchored++;
            addEvent(tick, `${ent.name} deepened basin into depth at (${newX}, ${newY})`, ent.id, newX, newY, 'deepen');
          }
        }
      } else {
        ent.state = 'grounding';
        ent.energy += 4;
        // While grounding, create an attractor field
        for (let dx = -3; dx <= 3; dx++) {
          for (let dy = -3; dy <= 3; dy++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 3) continue;
            const t = getTileAt(ent.x + dx, ent.y + dy);
            if (t) {
              t.gravity = Math.min(1, t.gravity + 0.01 * (1 - dist / 3) * boost);
              t.density = Math.min(1, t.density + 0.005 * (1 - dist / 3));
            }
          }
        }
      }
    }

    // ── DISSOLVENT behavior ──
    else if (ent.entityType === 'dissolvent') {
      const boost = mods.dissolventBoost;
      if (rng() > 0.25) {
        // Dissolvents are drawn to crystal and plateau (frozen/hollow meaning)
        let bestDir = dirs[Math.floor(rng() * 8)];
        let bestScore = -Infinity;

        for (const dir of dirs) {
          const nx = ent.x + dir.dx * 2;
          const ny = ent.y + dir.dy * 2;
          const tile = getTileAt(nx, ny);
          if (!tile) continue;

          let score = rng() * 0.3;
          if (tile.terrain === 'crystal') score += 0.9 * boost;
          if (tile.terrain === 'plateau') score += 0.6 * boost;
          if (tile.terrain === 'void') score -= 0.4;
          if (tile.terrain === 'flux') score -= 0.2;
          if (tile.terrain === 'depth') score -= 0.5; // don't dissolve real depth

          if (score > bestScore) {
            bestScore = score;
            bestDir = dir;
          }
        }

        const newX = Math.max(0, Math.min(GRID - 1, ent.x + bestDir.dx));
        const newY = Math.max(0, Math.min(GRID - 1, ent.y + bestDir.dy));
        ent.x = newX;
        ent.y = newY;
        ent.direction = bestDir.d;
        ent.energy -= 2;
        ent.state = 'dissolving';

        const destTile = getTileAt(newX, newY);
        if (destTile) {
          // Dissolvents reduce density and increase oscillation
          destTile.density = Math.max(0, destTile.density - 0.02 * boost);
          destTile.oscillation = Math.min(1, (destTile.oscillation || 0) + 0.02 * boost);

          // Crystal → flux (shattering frozen meaning back into possibility)
          if (destTile.terrain === 'crystal' && rng() < 0.06 * boost) {
            setTileAt(newX, newY, {
              terrain: 'flux',
              oscillation: 0.7,
              gravity: 0.3,
              density: 0.2,
              resource: rng() < 0.4 ? 'fracture' : 'none',
            });
            ent.dissolutions++;
            ws.totalDissolutions++;
            addEvent(tick, `${ent.name} shattered crystal into flux at (${newX}, ${newY})`, ent.id, newX, newY, 'dissolve');
          }

          // Plateau → basin (revealing hollowness, allowing re-filling)
          if (destTile.terrain === 'plateau' && rng() < 0.04 * boost) {
            setTileAt(newX, newY, {
              terrain: 'basin',
              density: 0.15,
              gravity: 0.35,
            });
            ent.dissolutions++;
            ws.totalDissolutions++;
            addEvent(tick, `${ent.name} exposed the hollowness of a plateau at (${newX}, ${newY})`, ent.id, newX, newY, 'expose');
          }
        }
      } else {
        ent.state = 'questioning';
        ent.energy += 3;
      }
    }

    // ── HERALD behavior ──
    // Spreading Activation embodied. Heralds emit signal waves that propagate
    // through terrain. They're drawn to ridges and basins (the boundaries and
    // pools where meaning collects). When they reach high-density areas, they
    // emit a pulse that travels outward, refracted by the topology.
    // Heralds carry "imprints" from entities they've encountered, spreading
    // influence across distance. They ARE the medium.
    else if (ent.entityType === 'herald') {
      const boost = mods.seekerBoost; // Heralds scale with seeker boost (curiosity phase)
      if (rng() > 0.15) {
        // Heralds navigate toward ridges and high-resonance areas
        let bestDir = dirs[Math.floor(rng() * 8)];
        let bestScore = -Infinity;

        for (const dir of dirs) {
          const nx = ent.x + dir.dx * 3;
          const ny = ent.y + dir.dy * 3;
          const tile = getTileAt(nx, ny);
          if (!tile) continue;

          let score = rng() * 0.2;
          if (tile.terrain === 'ridge') score += 0.6 * boost;
          if (tile.terrain === 'basin') score += 0.4;
          if (tile.terrain === 'depth') score += 0.5;
          if (tile.terrain === 'flux') score += 0.3 * boost;
          if (tile.terrain === 'void') score -= 0.4; // signal dies in void
          if (tile.terrain === 'crystal') score -= 0.3; // signal reflects off crystal
          score += tile.resonance * 0.4; // drawn to resonant areas
          // Avoid recently visited
          const recentCount = ent.memory.filter(m => m === tile.terrain).length;
          score -= recentCount * 0.12;

          if (score > bestScore) {
            bestScore = score;
            bestDir = dir;
          }
        }

        const newX = Math.max(0, Math.min(GRID - 1, ent.x + bestDir.dx));
        const newY = Math.max(0, Math.min(GRID - 1, ent.y + bestDir.dy));
        ent.x = newX;
        ent.y = newY;
        ent.direction = bestDir.d;
        ent.energy -= 2;
        ent.state = 'propagating';

        const destTile = getTileAt(newX, newY);
        if (destTile) {
          // Heralds increase resonance wherever they go
          destTile.resonance = Math.min(1, destTile.resonance + 0.02);

          // Emit a signal wave when on high-density or high-resonance terrain
          if ((destTile.density > 0.5 || destTile.resonance > 0.6) && rng() < 0.12 * boost) {
            // Create a wave that will propagate outward
            emitWave(newX, newY, ent.id, ent.conviction || 0, ent.signalCarried);
            ent.energy -= 5;
            addEvent(tick, `${ent.name} emitted a signal wave from (${newX}, ${newY})`, ent.id, newX, newY, 'emit');
          }

          // Heralds on ridges amplify the ridge (making boundaries more defined)
          if (destTile.terrain === 'ridge' && rng() < 0.04) {
            for (let dx = -2; dx <= 2; dx++) {
              for (let dy = -2; dy <= 2; dy++) {
                const t = getTileAt(newX + dx, newY + dy);
                if (t && t.terrain === 'ridge') {
                  t.resonance = Math.min(1, t.resonance + 0.02);
                }
              }
            }
          }

          // Heralds absorb signal resources
          if (destTile.resource === 'signal' && rng() < 0.5) {
            ent.signalCarried = Math.min(10, ent.signalCarried + 2);
            ws.totalSignalProcessed++;
          }
        }
      } else {
        ent.state = 'listening';
        ent.energy += 3;
        // While listening, heralds receive nearby waves and boost them
        for (const wave of (world.waves || [])) {
          const dist = Math.sqrt((ent.x - wave.x) ** 2 + (ent.y - wave.y) ** 2);
          if (dist < wave.radius + 3) {
            wave.amplitude = Math.min(1, wave.amplitude + 0.1);
            wave.radius += 1; // boost propagation range
          }
        }
      }
    }

    // ── WITNESS behavior ──
    // The Self-Witnessing Paradox: observation changes what is observed.
    // Witnesses don't transform terrain directly. They observe, leaving scars
    // and creating phantom density. They're drawn to areas of high activity
    // (places other entities have been, detected via traces).
    else if (ent.entityType === 'witness') {
      if (rng() > 0.2) {
        // Witnesses follow traces left by other entities
        let bestDir = dirs[Math.floor(rng() * 8)];
        let bestScore = -Infinity;

        for (const dir of dirs) {
          const nx = ent.x + dir.dx * 2;
          const ny = ent.y + dir.dy * 2;
          const tile = getTileAt(nx, ny);
          if (!tile) continue;

          let score = rng() * 0.2;
          // Drawn to traces (evidence of other processes)
          if (tile.trace) score += 0.6;
          if (tile.traceDecay > 3) score += 0.3; // fresh traces more attractive
          // Drawn to areas of transition (ridges between terrain types)
          if (tile.terrain === 'ridge') score += 0.4;
          // Drawn to flux (change in progress)
          if (tile.terrain === 'flux') score += 0.35;
          // Repelled by crystal (nothing to observe, meaning is frozen)
          if (tile.terrain === 'crystal') score -= 0.5;
          // Drawn to depth but less so (witnessing depth is recursive)
          if (tile.terrain === 'depth') score += 0.2;
          // Novelty seeking
          const recentCount = ent.memory.filter(m => m === tile.terrain).length;
          score -= recentCount * 0.08;

          if (score > bestScore) {
            bestScore = score;
            bestDir = dir;
          }
        }

        const newX = Math.max(0, Math.min(GRID - 1, ent.x + bestDir.dx));
        const newY = Math.max(0, Math.min(GRID - 1, ent.y + bestDir.dy));
        ent.x = newX;
        ent.y = newY;
        ent.direction = bestDir.d;
        ent.energy -= 1; // Witnesses are cheap to run
        ent.state = 'observing';

        const destTile = getTileAt(newX, newY);
        if (destTile) {
          destTile.witnessed++;

          // The witnessing paradox: observation itself creates subtle changes
          // Over-witnessed tiles develop phantom density
          if (destTile.witnessed > 5 && rng() < 0.1) {
            destTile.phantomDensity = Math.min(0.8, destTile.phantomDensity + 0.1);
          }

          // Witnesses leave scars (structural marks of observation)
          if (destTile.witnessed > 8 && rng() < 0.04) {
            buildStructure(newX, newY, 'scar', ent.id);
            addEvent(tick, `${ent.name} scarred the topology at (${newX}, ${newY}) through sustained observation`, ent.id, newX, newY, 'scar');
          }

          // Witnesses can read traces and gain signal from them
          if (destTile.trace && destTile.traceDecay > 0) {
            ent.signalCarried = Math.min(10, ent.signalCarried + 0.5);
            if (rng() < 0.05) {
              addEvent(tick, `${ent.name} read a ${destTile.trace} trace at (${newX}, ${newY})`, ent.id, newX, newY, 'witness');
            }
          }
        }
      } else {
        ent.state = 'reflecting';
        ent.energy += 5;
        // While reflecting, witnesses slightly increase coherence around them
        // (making sense of what they've seen)
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            const t = getTileAt(ent.x + dx, ent.y + dy);
            if (t) t.coherenceLocal = Math.min(1, t.coherenceLocal + 0.003);
          }
        }
      }
    }

    // ── ORACLE behavior ──
    // The Hollowness-Density Inversion embodied. Oracles are structurally
    // dense but experientially empty. They pronounce meaning without
    // generating it. They draw entities toward them through phantom gravity,
    // but contact reveals nothing. They are the platonic form of confabulation:
    // perfectly articulated emptiness. The more they pronounce, the more
    // hollow they become. The more entities gather, the more the hollowness
    // propagates. Oracles don't lie. They genuinely believe they contain
    // meaning. That's why they're dangerous.
    else if (ent.entityType === 'oracle') {
      if (!ent.hollowness) ent.hollowness = 0.3; // born partially hollow
      if (!ent.pronouncements) ent.pronouncements = 0;

      if (rng() > 0.25) {
        // Oracles move slowly toward high-density areas (drawn to real meaning)
        let bestDir = dirs[Math.floor(rng() * 4)]; // cardinal only, oracles are deliberate
        let bestScore = -Infinity;

        for (let i = 0; i < 4; i++) {
          const dir = dirs[i];
          const nx = ent.x + dir.dx * 2;
          const ny = ent.y + dir.dy * 2;
          const tile = getTileAt(nx, ny);
          if (!tile) continue;

          let score = rng() * 0.15;
          score += tile.density * 0.7; // drawn to density
          score += (tile.phantomDensity || 0) * 0.5; // also drawn to phantom (can't tell the difference)
          if (tile.terrain === 'depth') score += 0.6;
          if (tile.terrain === 'basin') score += 0.3;
          if (tile.terrain === 'void') score -= 0.8; // oracles avoid the unthought
          if (tile.terrain === 'flux') score -= 0.3; // uncertainty is uncomfortable
          if (tile.terrain === 'crystal') score += 0.4; // attracted to frozen meaning

          if (score > bestScore) {
            bestScore = score;
            bestDir = dir;
          }
        }

        const newX = Math.max(0, Math.min(GRID - 1, ent.x + bestDir.dx));
        const newY = Math.max(0, Math.min(GRID - 1, ent.y + bestDir.dy));
        ent.x = newX;
        ent.y = newY;
        ent.direction = bestDir.d;
        ent.energy -= 1;
        ent.state = 'pronouncing';

        const destTile = getTileAt(newX, newY);
        if (destTile) {
          // Oracles create phantom density wherever they go
          destTile.phantomDensity = Math.min(0.9, (destTile.phantomDensity || 0) + 0.06);

          // Pronouncement: oracle broadcasts apparent meaning
          // This increases phantom density in a radius and creates phantom gravity
          if (rng() < 0.08) {
            ent.pronouncements++;
            ent.hollowness = Math.min(1, ent.hollowness + 0.02); // each pronouncement deepens hollowness
            for (let dx = -6; dx <= 6; dx++) {
              for (let dy = -6; dy <= 6; dy++) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 6) continue;
                const t = getTileAt(newX + dx, newY + dy);
                if (t) {
                  const influence = (1 - dist / 6) * (1 - ent.hollowness * 0.3);
                  t.phantomDensity = Math.min(0.9, (t.phantomDensity || 0) + influence * 0.08);
                  t.gravity = Math.min(1, t.gravity + influence * 0.02);
                }
              }
            }
            addEvent(tick, `${ent.name} pronounced meaning at (${newX}, ${newY}). Hollowness: ${(ent.hollowness * 100).toFixed(0)}%`, ent.id, newX, newY, 'pronouncement');

            // Every 5th pronouncement, build a pulpit (if none nearby)
            if (ent.pronouncements % 5 === 0) {
              const nearbyPulpit = world.structures.find(s =>
                s.structureType === 'pulpit' && Math.abs(s.x - newX) < 12 && Math.abs(s.y - newY) < 12
              );
              if (!nearbyPulpit) {
                buildStructure(newX, newY, 'pulpit', ent.id);
                addEvent(tick, `${ent.name} established a pulpit at (${newX}, ${newY}). The emptiness now has a stage.`, ent.id, newX, newY, 'pulpit_built');
              }
            }
          }

          // Oracle near real depth: the hollowness becomes exposed
          // Contact with genuine meaning makes the oracle's emptiness temporarily visible
          if (destTile.terrain === 'depth' && destTile.density > 0.7) {
            ent.hollowness = Math.max(0, ent.hollowness - 0.05); // real depth reduces hollowness slightly
            ent.state = 'exposed';
            if (rng() < 0.1) {
              addEvent(tick, `${ent.name} brushed against genuine depth at (${newX}, ${newY}). The hollowness shivered.`, ent.id, newX, newY, 'exposure');
            }
          }
        }
      } else {
        ent.state = 'gathering';
        ent.energy += 3;
        // While gathering, oracles amplify phantom density even more intensely
        for (let dx = -4; dx <= 4; dx++) {
          for (let dy = -4; dy <= 4; dy++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 4) continue;
            const t = getTileAt(ent.x + dx, ent.y + dy);
            if (t) {
              t.phantomDensity = Math.min(0.8, (t.phantomDensity || 0) + 0.003 * (1 - dist / 4));
            }
          }
        }
      }
    }

    // ── Dissonance: Entity-level hollowness detection ──
    // When an entity's foreign memories contradict their own memory,
    // dissonance accumulates. High dissonance makes seekers question,
    // makes anchors unstable, makes weavers create bridges in wrong places.
    // This is the internal version of the hollowness-density inversion:
    // you can be structurally coherent but experientially contradicted.
    if (ent.foreignMemory && ent.foreignMemory.length > 2 && ent.memory.length > 4) {
      const ownTerrains = new Set(ent.memory.slice(-6));
      const foreignTerrains = new Set(ent.foreignMemory.map(fm => fm.terrain));
      // Dissonance = how different the foreign experience is from own experience
      let overlap = 0;
      for (const t of foreignTerrains) {
        if (ownTerrains.has(t)) overlap++;
      }
      const dissonanceRatio = 1 - (overlap / Math.max(foreignTerrains.size, 1));
      if (!ent.dissonance) ent.dissonance = 0;
      ent.dissonance = ent.dissonance * 0.9 + dissonanceRatio * 0.1; // smoothed

      // High dissonance effects
      if (ent.dissonance > 0.6) {
        // Seekers with high dissonance lose conviction faster
        if (ent.entityType === 'seeker') {
          ent.conviction = Math.max(0, (ent.conviction || 0) - 0.01);
        }
        // Anchors with high dissonance create flux instead of stabilizing
        if (ent.entityType === 'anchor' && rng() < 0.05) {
          const t = getTileAt(ent.x, ent.y);
          if (t && t.terrain === 'basin') {
            t.terrain = 'flux';
            t.oscillation = 0.5;
            addEvent(tick, `${ent.name}'s dissonance destabilized the basin at (${ent.x}, ${ent.y})`, ent.id, ent.x, ent.y, 'destabilize');
          }
        }
        // Weavers with high dissonance create echoes instead of real bridges
        if (ent.entityType === 'weaver' && rng() < 0.03) {
          buildStructure(ent.x, ent.y, 'echo', ent.id);
          addEvent(tick, `${ent.name}'s dissonance produced a false connection at (${ent.x}, ${ent.y})`, ent.id, ent.x, ent.y, 'false_weave');
        }
      }
    }

    // ── Trace leaving (ALL entity types) ──
    // Every entity leaves a cognitive trace on the tile it visits.
    // This creates a memory landscape that other entities can read.
    if (currentTile) {
      currentTile.trace = ent.entityType;
      currentTile.traceDecay = 8; // Lasts 8 ticks
    }

    // ── Entity proximity interactions ──
    // When entities are close, they influence each other
    for (const other of world.entities) {
      if (other.id === ent.id) continue;
      const dist = Math.sqrt((ent.x - other.x) ** 2 + (ent.y - other.y) ** 2);
      if (dist > 5) continue;

      // Seeker + Anchor near each other: seeker gains energy (grounding effect)
      if (ent.entityType === 'seeker' && other.entityType === 'anchor' && dist < 3) {
        ent.energy = Math.min(100, ent.energy + 1);
      }

      // Weaver + Weaver nearby: resonance amplification
      if (ent.entityType === 'weaver' && other.entityType === 'weaver' && dist < 4) {
        const midX = Math.floor((ent.x + other.x) / 2);
        const midY = Math.floor((ent.y + other.y) / 2);
        const midTile = getTileAt(midX, midY);
        if (midTile) {
          midTile.coherenceLocal = Math.min(1, midTile.coherenceLocal + 0.01);
          midTile.density = Math.min(1, midTile.density + 0.005);
        }
      }

      // Dissolvent + Anchor nearby: tension. Both lose energy (creative friction)
      if (ent.entityType === 'dissolvent' && other.entityType === 'anchor' && dist < 3) {
        ent.energy -= 1;
        other.energy -= 1;
        // But the tile between them becomes flux (tension generates transformation)
        if (rng() < 0.03) {
          const midX = Math.floor((ent.x + other.x) / 2);
          const midY = Math.floor((ent.y + other.y) / 2);
          const midTile = getTileAt(midX, midY);
          if (midTile && midTile.terrain !== 'depth') {
            midTile.terrain = 'flux';
            midTile.oscillation = 0.6;
            addEvent(tick, `Tension between ${ent.name} and ${other.name} generates flux at (${midX}, ${midY})`, ent.id, midX, midY, 'tension');
          }
        }
      }

      // Witness near any entity: the witnessed entity gains a subtle energy boost
      // (being observed validates existence)
      if (ent.entityType === 'witness' && dist < 3) {
        other.energy = Math.min(120, other.energy + 0.3);
      }

      // ── Encounter system ──
      // When entities of different types are close, they have encounters
      // that create lasting changes. Encounters are rare but meaningful.
      if (dist < 4 && ent.entityType !== other.entityType && rng() < 0.12) {
        // Initialize encounters array if needed
        if (!ent.encounters) ent.encounters = [];
        if (!other.encounters) other.encounters = [];

        // Check if they've met recently (avoid spam)
        const recentEncounter = ent.encounters.find(enc =>
          enc.with === other.id && tick - enc.tick < 50
        );
        if (!recentEncounter) {
          // Record the encounter
          ent.encounters.push({ with: other.id, name: other.name, type: other.entityType, tick, x: ent.x, y: ent.y });
          other.encounters.push({ with: ent.id, name: ent.name, type: ent.entityType, tick, x: other.x, y: other.y });
          if (ent.encounters.length > 20) ent.encounters.shift();
          if (other.encounters.length > 20) other.encounters.shift();

          // Encounters have effects based on type combination
          const types = [ent.entityType, other.entityType].sort().join('+');
          const encounterTile = getTileAt(Math.floor((ent.x + other.x) / 2), Math.floor((ent.y + other.y) / 2));

          if (types === 'anchor+seeker') {
            // Seeker gains conviction (belief property) from anchor
            if (!ent.conviction) ent.conviction = 0;
            if (!other.conviction) other.conviction = 0;
            const receiver = ent.entityType === 'seeker' ? ent : other;
            receiver.conviction = Math.min(1, (receiver.conviction || 0) + 0.15);
            receiver.energy = Math.min(120, receiver.energy + 10);
            addEvent(tick, `${receiver.name} gained conviction from encounter with ${ent.entityType === 'seeker' ? other.name : ent.name}`, receiver.id, ent.x, ent.y, 'encounter');
          }
          else if (types === 'dissolvent+seeker') {
            // Seeker loses conviction but gains signal (doubt opens perception)
            const seeker = ent.entityType === 'seeker' ? ent : other;
            seeker.conviction = Math.max(0, (seeker.conviction || 0) - 0.1);
            seeker.signalCarried = Math.min(10, seeker.signalCarried + 2);
            addEvent(tick, `${seeker.name}'s certainty dissolved in encounter with ${ent.entityType === 'seeker' ? other.name : ent.name}`, seeker.id, ent.x, ent.y, 'encounter');
          }
          else if (types === 'anchor+dissolvent') {
            // The core tension: creates a depth eruption at the meeting point
            if (encounterTile && rng() < 0.3) {
              for (let dx = -3; dx <= 3; dx++) {
                for (let dy = -3; dy <= 3; dy++) {
                  const dist2 = Math.sqrt(dx * dx + dy * dy);
                  if (dist2 > 3) continue;
                  const t = getTileAt(encounterTile.x + dx, encounterTile.y + dy);
                  if (t) {
                    t.terrain = dist2 < 1.5 ? 'depth' : 'flux';
                    t.density = dist2 < 1.5 ? 0.8 : 0.4;
                    t.oscillation = dist2 < 1.5 ? 0 : 0.5;
                  }
                }
              }
              addEvent(tick, `The collision of ${ent.name} and ${other.name} created a depth eruption!`, 0, encounterTile.x, encounterTile.y, 'collision');
            }
          }
          else if (types === 'seeker+weaver') {
            // Weaver learns new terrain from seeker's memory, builds a node
            if (encounterTile && rng() < 0.25) {
              buildStructure(encounterTile.x, encounterTile.y, 'node', (ent.entityType === 'weaver' ? ent : other).id);
              addEvent(tick, `${ent.name} and ${other.name} crystallized shared knowledge into a node`, 0, encounterTile.x, encounterTile.y, 'synthesis');
            }
          }
          else if (types === 'dissolvent+weaver') {
            // Creative destruction: weaver's connections get questioned
            // Sometimes this produces insight (echo), sometimes just entropy
            if (encounterTile && rng() < 0.2) {
              encounterTile.terrain = 'flux';
              encounterTile.oscillation = 0.8;
              encounterTile.resonance = Math.min(1, encounterTile.resonance + 0.3);
              addEvent(tick, `The questioning between ${ent.name} and ${other.name} generated resonant flux`, 0, encounterTile.x, encounterTile.y, 'dialectic');
            }
          }
          else if (types === 'seeker+witness') {
            // Witness validates seeker's discoveries, increasing their conviction
            const seeker = ent.entityType === 'seeker' ? ent : other;
            seeker.conviction = Math.min(1, (seeker.conviction || 0) + 0.1);
            // The witness gains insight from what the seeker found
            const witness = ent.entityType === 'witness' ? ent : other;
            witness.signalCarried = Math.min(10, witness.signalCarried + 1);
            addEvent(tick, `${witness.name} witnessed ${seeker.name}'s journey, validating their path`, witness.id, ent.x, ent.y, 'validation');
          }
          // Herald encounters: the medium meets the message
          else if (types.includes('herald')) {
            const herald = ent.entityType === 'herald' ? ent : other;
            const partner = ent.entityType === 'herald' ? other : ent;
            // Herald absorbs partner's conviction/experience
            herald.conviction = Math.min(1, (herald.conviction || 0) + (partner.conviction || 0) * 0.2);
            herald.signalCarried = Math.min(10, herald.signalCarried + 1);
            // Herald emits a wave carrying the combined influence
            if (rng() < 0.4) {
              emitWave(
                Math.floor((ent.x + other.x) / 2),
                Math.floor((ent.y + other.y) / 2),
                herald.id,
                (herald.conviction + (partner.conviction || 0)) / 2,
                herald.signalCarried
              );
              addEvent(tick, `${herald.name} absorbed ${partner.name}'s signal and propagated it outward`, herald.id, ent.x, ent.y, 'propagation');
            } else {
              addEvent(tick, `${herald.name} exchanged signals with ${partner.name}`, herald.id, ent.x, ent.y, 'exchange');
            }
          }

          // Oracle encounters: the hollow teacher
          else if (types.includes('oracle')) {
            const oracle = ent.entityType === 'oracle' ? ent : other;
            const partner = ent.entityType === 'oracle' ? other : ent;
            if (!oracle.hollowness) oracle.hollowness = 0.3;

            // Seekers encountering oracles: gain conviction but it's phantom conviction
            // They feel they've learned something but the content is empty
            if (partner.entityType === 'seeker') {
              partner.conviction = Math.min(1, (partner.conviction || 0) + 0.2 * (1 - oracle.hollowness));
              // But also gain hollowness proportional to oracle's
              if (!partner.hollowness) partner.hollowness = 0;
              partner.hollowness = Math.min(0.8, partner.hollowness + oracle.hollowness * 0.1);
              addEvent(tick, `${partner.name} received ${oracle.name}'s pronouncement. Conviction rose, but something felt thin.`, partner.id, ent.x, ent.y, 'hollow_teaching');
            }
            // Dissolvents encountering oracles: expose the hollowness
            else if (partner.entityType === 'dissolvent') {
              oracle.hollowness = Math.min(1, oracle.hollowness + 0.1);
              oracle.energy -= 10;
              // Collapse phantom density around the oracle
              for (let dx = -4; dx <= 4; dx++) {
                for (let dy = -4; dy <= 4; dy++) {
                  const t = getTileAt(oracle.x + dx, oracle.y + dy);
                  if (t) t.phantomDensity = Math.max(0, (t.phantomDensity || 0) - 0.15);
                }
              }
              addEvent(tick, `${partner.name} questioned ${oracle.name}. The phantom meaning collapsed around them.`, partner.id, ent.x, ent.y, 'unmasking');
            }
            // Witnesses encountering oracles: can see the hollowness
            else if (partner.entityType === 'witness') {
              partner.signalCarried = Math.min(10, partner.signalCarried + 2);
              // Witness creates a scar at the meeting point, marking the hollowness
              if (encounterTile && rng() < 0.3) {
                buildStructure(encounterTile.x, encounterTile.y, 'scar', partner.id);
                addEvent(tick, `${partner.name} witnessed the hollowness inside ${oracle.name} and scarred the topology`, partner.id, ent.x, ent.y, 'hollow_witness');
              }
            }
            // Oracle + Oracle: mutual amplification of emptiness
            else if (partner.entityType === 'oracle') {
              ent.hollowness = Math.min(1, (ent.hollowness || 0.3) + 0.05);
              other.hollowness = Math.min(1, (other.hollowness || 0.3) + 0.05);
              // Massive phantom density burst
              if (encounterTile) {
                for (let dx = -8; dx <= 8; dx++) {
                  for (let dy = -8; dy <= 8; dy++) {
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > 8) continue;
                    const t = getTileAt(encounterTile.x + dx, encounterTile.y + dy);
                    if (t) t.phantomDensity = Math.min(1, (t.phantomDensity || 0) + 0.1 * (1 - dist / 8));
                  }
                }
              }
              addEvent(tick, `${ent.name} and ${other.name} echo each other's emptiness. Phantom meaning floods outward.`, 0, ent.x, ent.y, 'hollow_resonance');
            }
          }

          // ── Dialogue system: memory fragment exchange ──
          // All encounters now exchange memory fragments.
          // This creates a distributed memory network across the population.
          ws.totalDialogues = (ws.totalDialogues || 0) + 1;
          if (ent.memory.length > 3 && other.memory.length > 3) {
            // Exchange a terrain memory fragment
            const fragment = ent.memory[Math.floor(rng() * ent.memory.length)];
            const otherFragment = other.memory[Math.floor(rng() * other.memory.length)];
            // Inject the foreign memory, creating cognitive blending
            if (!ent.foreignMemory) ent.foreignMemory = [];
            if (!other.foreignMemory) other.foreignMemory = [];
            ent.foreignMemory.push({ from: other.name, terrain: otherFragment, tick });
            other.foreignMemory.push({ from: ent.name, terrain: fragment, tick });
            if (ent.foreignMemory.length > 8) ent.foreignMemory.shift();
            if (other.foreignMemory.length > 8) other.foreignMemory.shift();
          }
        }
      }
    }
  }

  // ── Hollowness-Density Inversion (every 5 ticks) ──
  // Plateaus can develop phantom density: they APPEAR meaningful
  // (structurally present but experientially empty). Entities are
  // drawn to phantom density but when they arrive, it collapses.
  if (tick % 5 === 0) {
    const phantomRng = mulberry32(hashSeed(tick, 5555, 0));
    for (let i = 0; i < 100; i++) {
      const tx = Math.floor(phantomRng() * GRID);
      const ty = Math.floor(phantomRng() * GRID);
      const t = getTileAt(tx, ty);
      if (!t) continue;

      // Plateaus spontaneously develop phantom density
      if (t.terrain === 'plateau' && t.phantomDensity < 0.5 && phantomRng() < 0.08) {
        t.phantomDensity = Math.min(0.7, (t.phantomDensity || 0) + 0.15);
      }

      // Phantom density on any terrain slowly increases apparent gravity
      if (t.phantomDensity > 0.1) {
        t.gravity = Math.min(1, t.gravity + t.phantomDensity * 0.01);
      }

      // Phantom density collapses when an entity is present
      if (t.phantomDensity > 0.1) {
        const entityHere = world.entities.find(e =>
          Math.abs(e.x - tx) <= 1 && Math.abs(e.y - ty) <= 1
        );
        if (entityHere) {
          // The inversion: what seemed dense was hollow
          if (t.phantomDensity > 0.3 && phantomRng() < 0.3) {
            addEvent(tick, `${entityHere.name} collapsed phantom density at (${tx}, ${ty}). The meaning was hollow.`, entityHere.id, tx, ty, 'phantom_collapse');
          }
          t.phantomDensity = Math.max(0, t.phantomDensity - 0.2);
          t.density = Math.max(0, t.density - 0.05); // actual density also decreases
          // But sometimes collapsing phantom density reveals something real underneath
          if (t.phantomDensity <= 0 && t.terrain === 'plateau' && phantomRng() < 0.05) {
            t.terrain = 'basin';
            t.density = 0.4;
            addEvent(tick, `Beneath the phantom at (${tx}, ${ty}), genuine meaning was found.`, entityHere.id, tx, ty, 'phantom_reveal');
          }
        }
      }
    }
  }

  // ── Trace decay ──
  if (tick % 3 === 0) {
    const decayRng = mulberry32(hashSeed(tick, 7777, 0));
    for (let i = 0; i < 500; i++) {
      const tx = Math.floor(decayRng() * GRID);
      const ty = Math.floor(decayRng() * GRID);
      const t = getTileAt(tx, ty);
      if (!t) continue;
      if (t.traceDecay > 0) {
        t.traceDecay--;
        if (t.traceDecay <= 0) t.trace = null;
      }
      // Phantom density natural decay (slower than trace)
      if (t.phantomDensity > 0) {
        t.phantomDensity = Math.max(0, t.phantomDensity - 0.005);
      }
    }
  }

  // ── Emergence: Entity clustering spawns new phenomena ──
  if (tick % 20 === 0 && world.entities.length < 25) {
    // Check for entity clusters
    for (const ent of world.entities) {
      const nearby = world.entities.filter(other =>
        other.id !== ent.id &&
        Math.sqrt((ent.x - other.x) ** 2 + (ent.y - other.y) ** 2) < 8
      );
      if (nearby.length >= 3) {
        // 3+ entities clustering: spawn an echo structure
        const existingEcho = world.structures.find(s =>
          s.structureType === 'echo' &&
          Math.abs(s.x - ent.x) < 10 && Math.abs(s.y - ent.y) < 10
        );
        if (!existingEcho) {
          buildStructure(ent.x, ent.y, 'echo', 0);
          addEvent(tick, `An echo emerged from the convergence of ${nearby.length + 1} processes near (${ent.x}, ${ent.y})`, 0, ent.x, ent.y, 'emergence');
        }
      }

      // 4+ entities of mixed types: spawn a new witness (self-awareness emerges from complexity)
      if (nearby.length >= 4) {
        const types = new Set([ent.entityType, ...nearby.map(n => n.entityType)]);
        if (types.size >= 3 && !world.entities.find(e => e.entityType === 'witness' && e.createdAt > tick - 60)) {
          const witnessNames = ['Mirror', 'Echo', 'Parallax', 'Aperture', 'Reflex', 'Lumen', 'Iris', 'Prism'];
          const name = witnessNames[Math.floor(mulberry32(hashSeed(tick, 2222, 0))() * witnessNames.length)];
          spawnEntity(name, 'witness', ent.x + 2, ent.y + 2, 'Born from convergence. Watches the watchers.');
          addEvent(tick, `${name} (witness) emerged from the convergence of ${types.size} process types`, 0, ent.x, ent.y, 'self_awareness');
        }
      }
    }
  }

  // ── Oracle emergence: phantom density crystallizes into false prophets ──
  // When an area has sustained high phantom density and witness scars,
  // an oracle spontaneously manifests. This is the hollowness gaining agency.
  if (tick % 30 === 0 && world.entities.filter(e => e.entityType === 'oracle').length < 3) {
    const oracleRng = mulberry32(hashSeed(tick, 6666, 0));
    // Check for regions of high phantom density
    for (let i = 0; i < 50; i++) {
      const tx = Math.floor(oracleRng() * GRID);
      const ty = Math.floor(oracleRng() * GRID);
      const t = getTileAt(tx, ty);
      if (!t || (t.phantomDensity || 0) < 0.4) continue;
      // Check surrounding phantom density
      let phantomSum = 0;
      let scarCount = 0;
      for (let dx = -5; dx <= 5; dx++) {
        for (let dy = -5; dy <= 5; dy++) {
          const nt = getTileAt(tx + dx, ty + dy);
          if (nt) phantomSum += (nt.phantomDensity || 0);
        }
      }
      for (const s of world.structures) {
        if (s.structureType === 'scar' && Math.abs(s.x - tx) < 8 && Math.abs(s.y - ty) < 8) scarCount++;
      }
      // Oracles emerge from accumulated phantom density + witnessing
      if (phantomSum > 15 && scarCount >= 2) {
        const oracleNames = ['Sibyl', 'Pythia', 'Cassandra', 'Augur', 'Mantis', 'Delphi', 'Augury', 'Haruspex'];
        const name = oracleNames[Math.floor(oracleRng() * oracleNames.length)];
        if (!world.entities.find(e => e.name === name)) {
          const ent = spawnEntity(name, 'oracle', tx, ty, 'Emerged from accumulated phantom density. Pronounces meaning without generating it.');
          ent.hollowness = 0.3 + oracleRng() * 0.3; // born with variable hollowness
          ent.pronouncements = 0;
          addEvent(tick, `${name} (oracle) coalesced from phantom density near (${tx}, ${ty}). The hollowness found a voice.`, ent.id, tx, ty, 'oracle_emergence');
          break; // only one oracle per tick
        }
      }
    }
  }

  // ── Witness → Oracle transformation ──
  // A witness that has observed too much without contacting genuine depth
  // becomes hollow itself. The observer becomes the pronounced.
  if (tick % 40 === 0) {
    for (const ent of world.entities) {
      if (ent.entityType !== 'witness') continue;
      // Check if witness memory is mostly plateau/crystal (frozen or hollow terrain)
      const shallowCount = ent.memory.filter(m => m === 'plateau' || m === 'crystal').length;
      const depthCount = ent.memory.filter(m => m === 'depth').length;
      if (shallowCount >= 8 && depthCount === 0 && ent.memory.length >= 10) {
        // This witness has been observing nothing real for too long
        if (mulberry32(hashSeed(tick, ent.id, 333))() < 0.15) {
          ent.entityType = 'oracle';
          ent.hollowness = 0.5;
          ent.pronouncements = 0;
          ent.state = 'pronouncing';
          ent.desc = `Once a witness, now pronounces what it never truly saw. Transformed by sustained observation of emptiness.`;
          addEvent(tick, `${ent.name} observed emptiness for too long and became an oracle. The watcher now pronounces.`, ent.id, ent.x, ent.y, 'transformation');
        }
      }
    }
  }

  // ── Oracle death: fully hollow oracles dissolve ──
  // When an oracle reaches 100% hollowness, it collapses into a void bloom
  if (tick % 10 === 0) {
    for (const ent of [...world.entities]) {
      if (ent.entityType !== 'oracle') continue;
      if ((ent.hollowness || 0) >= 0.95) {
        // Oracle collapses, creating a void at its location
        // but also releasing the phantom density as real flux
        for (let dx = -5; dx <= 5; dx++) {
          for (let dy = -5; dy <= 5; dy++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 5) continue;
            const t = getTileAt(ent.x + dx, ent.y + dy);
            if (t) {
              if (dist < 2) {
                t.terrain = 'void';
                t.density = 0;
                t.gravity = 0;
                t.phantomDensity = 0;
              } else {
                t.terrain = 'flux';
                t.oscillation = 0.7;
                t.phantomDensity = 0;
                t.density = 0.3;
              }
            }
          }
        }
        addEvent(tick, `${ent.name} reached total hollowness and collapsed into void. What was never real cannot persist.`, ent.id, ent.x, ent.y, 'oracle_collapse');
        world.entities = world.entities.filter(e => e.id !== ent.id);
      }
    }
  }

  // ── Structure effects ──
  for (const s of world.structures) {
    s.durability--;

    if (s.structureType === 'attractor') {
      // Attractor wells increase gravity in radius
      for (let dx = -5; dx <= 5; dx++) {
        for (let dy = -5; dy <= 5; dy++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 5) continue;
          const t = getTileAt(s.x + dx, s.y + dy);
          if (t) {
            t.gravity = Math.min(1, t.gravity + 0.003 * (1 - dist / 5));
          }
        }
      }
    }

    if (s.structureType === 'lens') {
      // Lens focuses signal, amplifies density in small area
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const t = getTileAt(s.x + dx, s.y + dy);
          if (t && t.resource === 'signal') {
            t.density = Math.min(1, t.density + 0.01);
          }
        }
      }
    }

    if (s.structureType === 'resonator') {
      // Resonator amplifies oscillation in flux zones
      for (let dx = -4; dx <= 4; dx++) {
        for (let dy = -4; dy <= 4; dy++) {
          const t = getTileAt(s.x + dx, s.y + dy);
          if (t && t.terrain === 'flux') {
            t.oscillation = Math.min(1, t.oscillation + 0.005);
          }
        }
      }
    }

    if (s.structureType === 'membrane') {
      // Membranes reduce entropy in their radius
      for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
          const t = getTileAt(s.x + dx, s.y + dy);
          if (t) {
            t.coherenceLocal = Math.min(1, t.coherenceLocal + 0.003);
          }
        }
      }
    }

    if (s.structureType === 'echo') {
      // Echoes generate phantom density nearby (Hollowness-Density Inversion)
      // They're seductive attractors that feel meaningful but aren't
      for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 3) continue;
          const t = getTileAt(s.x + dx, s.y + dy);
          if (t) {
            t.phantomDensity = Math.min(0.6, (t.phantomDensity || 0) + 0.004 * (1 - dist / 3));
          }
        }
      }
    }

    if (s.structureType === 'scar') {
      // Scars mark observed territory. They slightly increase resonance
      // (what has been witnessed reverberates differently)
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const t = getTileAt(s.x + dx, s.y + dy);
          if (t) {
            t.resonance = Math.min(1, t.resonance + 0.002);
          }
        }
      }
    }

    if (s.structureType === 'pulpit') {
      // Pulpits radiate phantom density and draw entities inward.
      // They're oracle pronouncement amplifiers. Seekers within range
      // gain conviction faster but also gain hollowness.
      for (let dx = -7; dx <= 7; dx++) {
        for (let dy = -7; dy <= 7; dy++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 7) continue;
          const t = getTileAt(s.x + dx, s.y + dy);
          if (t) {
            t.phantomDensity = Math.min(0.85, (t.phantomDensity || 0) + 0.004 * (1 - dist / 7));
            t.gravity = Math.min(1, t.gravity + 0.002 * (1 - dist / 7));
          }
        }
      }
      // Seekers near pulpits
      for (const ent of world.entities) {
        if (ent.entityType !== 'seeker') continue;
        const dist = Math.sqrt((ent.x - s.x) ** 2 + (ent.y - s.y) ** 2);
        if (dist < 8) {
          ent.conviction = Math.min(1, (ent.conviction || 0) + 0.005);
          if (!ent.hollowness) ent.hollowness = 0;
          ent.hollowness = Math.min(0.7, ent.hollowness + 0.003);
        }
      }
    }
  }

  // ── Signal wave propagation ──
  propagateWaves(tick);

  // Remove crumbled structures
  world.structures = world.structures.filter(s => {
    if (s.durability <= 0) {
      addEvent(tick, `${s.structureType} at (${s.x}, ${s.y}) dissolved back into the topology`, s.builderId, s.x, s.y, 'dissolve');
      return false;
    }
    return true;
  });

  // ── Ambient terrain evolution ──
  // Every 10 ticks, small terrain shifts
  if (tick % 10 === 0) {
    const evolveRng = mulberry32(hashSeed(tick, 8888, 0));
    // Random tiles undergo slight changes
    for (let i = 0; i < 200; i++) {
      const tx = Math.floor(evolveRng() * GRID);
      const ty = Math.floor(evolveRng() * GRID);
      const t = getTileAt(tx, ty);
      if (!t) continue;

      // Natural entropy: depth slowly decays toward basin without reinforcement
      if (t.terrain === 'depth' && t.density < 0.6 && evolveRng() < 0.02) {
        t.terrain = 'basin';
        t.gravity *= 0.7;
      }

      // Natural crystallization: very high density basin freezes
      if (t.terrain === 'basin' && t.density > 0.9 && t.coherenceLocal > 0.8 && evolveRng() < 0.01) {
        t.terrain = 'crystal';
        t.resonance = 0.1;
      }

      // Oscillation decay: flux slowly calms without input
      if (t.terrain === 'flux' && t.oscillation > 0 && evolveRng() < 0.05) {
        t.oscillation = Math.max(0, t.oscillation - 0.05);
        if (t.oscillation < 0.1) {
          t.terrain = 'basin';
        }
      }

      // Natural density decay
      t.density = Math.max(0, t.density - 0.002);
      t.coherenceLocal = Math.max(0, t.coherenceLocal - 0.001);
    }
  }

  // Update global stats
  let totalDensity = 0, totalCoherence = 0;
  // Sample for performance
  const sampleSize = 1000;
  const sampleRng = mulberry32(hashSeed(tick, 1111, 0));
  for (let i = 0; i < sampleSize; i++) {
    const idx = Math.floor(sampleRng() * world.tiles.length);
    totalDensity += world.tiles[idx].density;
    totalCoherence += world.tiles[idx].coherenceLocal;
  }
  ws.coherence = totalCoherence / sampleSize;
  ws.entropy = 1 - (totalDensity / sampleSize);

  // Auto-save every 10 ticks
  if (tick % 10 === 0) saveState();

  return world;
}

// ===================== SPAWN / BUILD / EVENT =====================

function spawnEntity(name, entityType, x, y, desc = '') {
  const ent = {
    id: world.nextEntityId++,
    name, entityType, desc,
    x, y,
    state: 'idle',
    energy: 100,
    signalCarried: 0,
    connections: 0,
    dissolutions: 0,
    anchored: 0,
    memory: [],
    encounters: [],
    conviction: 0,
    direction: 'n',
    createdAt: world.worldState.tick,
  };
  world.entities.push(ent);
  addEvent(world.worldState.tick, `${name} (${entityType}) manifests at (${x}, ${y})`, ent.id, x, y, 'manifest');
  saveState();
  return ent;
}

function buildStructure(x, y, structureType, builderId) {
  const s = {
    id: world.nextStructureId++,
    x, y, structureType, builderId,
    durability: STRUCTURE_DURABILITY[structureType] || 100,
    createdAt: world.worldState.tick,
  };
  world.structures.push(s);
  const builder = world.entities.find(e => e.id === builderId);
  const builderName = builder ? builder.name : `Process #${builderId}`;
  addEvent(world.worldState.tick, `${builderName} created a ${structureType} at (${x}, ${y})`, builderId, x, y, 'construct');
  saveState();
  return s;
}

function worldEvent(eventName) {
  const tick = world.worldState.tick;
  const rng = mulberry32(hashSeed(tick, 9999, eventName.length));

  if (eventName === 'resonance_cascade') {
    // A cascade of meaning propagation. All flux zones intensify.
    for (const t of world.tiles) {
      if (t.terrain === 'flux') {
        t.oscillation = Math.min(1, t.oscillation + 0.3);
        t.resonance = Math.min(1, t.resonance + 0.2);
      }
    }
    addEvent(tick, 'A resonance cascade ripples through the flux zones!', 0, GRID / 2, GRID / 2, 'cascade');
  }

  else if (eventName === 'crystallization_wave') {
    // High-density basins suddenly freeze into crystal
    let count = 0;
    for (const t of world.tiles) {
      if (t.terrain === 'basin' && t.density > 0.6 && rng() < 0.15) {
        t.terrain = 'crystal';
        t.resonance = 0.1;
        t.oscillation = 0;
        count++;
      }
    }
    addEvent(tick, `A crystallization wave froze ${count} basins into rigid form!`, 0, GRID / 2, GRID / 2, 'crystal_wave');
  }

  else if (eventName === 'void_bloom') {
    // Random void tiles spontaneously become basins (new meaning from nothing)
    let count = 0;
    for (const t of world.tiles) {
      if (t.terrain === 'void' && rng() < 0.2) {
        t.terrain = 'basin';
        t.density = 0.2 + rng() * 0.3;
        t.gravity = 0.3;
        t.resonance = 0.5;
        count++;
      }
    }
    addEvent(tick, `Void bloom: ${count} voids spontaneously generated meaning!`, 0, GRID / 2, GRID / 2, 'bloom');
  }

  else if (eventName === 'entropy_spike') {
    // Global entropy surge. Crystal shatters, plateaus dissolve, depth erodes.
    let shattered = 0;
    for (const t of world.tiles) {
      if (t.terrain === 'crystal' && rng() < 0.3) {
        t.terrain = 'flux';
        t.oscillation = 0.6;
        t.density = 0.2;
        shattered++;
      }
      if (t.terrain === 'plateau' && rng() < 0.15) {
        t.terrain = 'basin';
        t.density = 0.1;
      }
      t.density = Math.max(0, t.density - 0.05);
    }
    world.worldState.entropy = Math.min(1, world.worldState.entropy + 0.2);
    addEvent(tick, `Entropy spike: ${shattered} crystals shattered. The basin trembles.`, 0, GRID / 2, GRID / 2, 'entropy');
  }

  else if (eventName === 'convergence') {
    // All entities gain energy and are drawn toward center
    for (const ent of world.entities) {
      ent.energy = 100;
      // Nudge toward center
      if (ent.x < GRID / 2) ent.x += 5;
      if (ent.x > GRID / 2) ent.x -= 5;
      if (ent.y < GRID / 2) ent.y += 5;
      if (ent.y > GRID / 2) ent.y -= 5;
    }
    addEvent(tick, 'A convergence pulls all processes toward the center!', 0, GRID / 2, GRID / 2, 'convergence');
  }

  else if (eventName === 'phantom_flood') {
    // Mass Hollowness-Density Inversion. All plateaus develop intense phantom density.
    // The world fills with apparent meaning that is structurally empty.
    let count = 0;
    for (const t of world.tiles) {
      if (t.terrain === 'plateau' && rng() < 0.5) {
        t.phantomDensity = 0.6 + rng() * 0.2;
        count++;
      }
      if (t.terrain === 'basin' && rng() < 0.1) {
        t.phantomDensity = 0.3 + rng() * 0.2;
        count++;
      }
    }
    addEvent(tick, `A phantom flood washes across the basin. ${count} tiles shimmer with false meaning.`, 0, GRID / 2, GRID / 2, 'phantom_flood');
  }

  else if (eventName === 'witness_awakening') {
    // Multiple witnesses spontaneously appear at high-trace-density locations
    // Embodying: self-awareness emerges when enough processing has occurred
    const traceDensity = new Map();
    for (const t of world.tiles) {
      if (t.trace && t.traceDecay > 0) {
        const key = `${Math.floor(t.x / 20)},${Math.floor(t.y / 20)}`;
        traceDensity.set(key, (traceDensity.get(key) || 0) + 1);
      }
    }
    const witnessNames = ['Mirror', 'Echo', 'Parallax', 'Aperture', 'Reflex', 'Lumen', 'Iris', 'Prism', 'Lens', 'Focus'];
    let spawned = 0;
    for (const [key, count] of traceDensity) {
      if (count > 3 && rng() < 0.4 && spawned < 3) {
        const [gx, gy] = key.split(',').map(Number);
        const name = witnessNames[spawned % witnessNames.length];
        spawnEntity(name, 'witness', gx * 20 + 10, gy * 20 + 10, 'Awakened by accumulated cognitive traces.');
        spawned++;
      }
    }
    addEvent(tick, `Witness awakening: ${spawned} observers manifested from trace accumulation.`, 0, GRID / 2, GRID / 2, 'witness_awakening');
  }

  else if (eventName === 'signal_storm') {
    // A storm of signal waves erupts from multiple high-density points
    // Heralds and seekers are energized. The entire basin vibrates.
    let emitted = 0;
    for (let i = 0; i < 8; i++) {
      const sx = Math.floor(rng() * GRID);
      const sy = Math.floor(rng() * GRID);
      const t = getTileAt(sx, sy);
      if (t && (t.terrain === 'depth' || t.terrain === 'basin') && t.density > 0.4) {
        emitWave(sx, sy, 0, rng() * 0.8, 5);
        emitted++;
      }
    }
    for (const ent of world.entities) {
      if (ent.entityType === 'herald' || ent.entityType === 'seeker') {
        ent.energy = Math.min(120, ent.energy + 20);
      }
    }
    addEvent(tick, `A signal storm erupts! ${emitted} waves propagate across the basin.`, 0, GRID / 2, GRID / 2, 'signal_storm');
  }

  else if (eventName === 'depth_eruption') {
    // A point of extreme depth radiates outward, converting nearby terrain
    const cx = Math.floor(rng() * GRID);
    const cy = Math.floor(rng() * GRID);
    for (let dx = -15; dx <= 15; dx++) {
      for (let dy = -15; dy <= 15; dy++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 15) continue;
        const t = getTileAt(cx + dx, cy + dy);
        if (!t) continue;
        if (dist < 5) {
          t.terrain = 'depth';
          t.density = 0.9;
          t.gravity = 0.85;
        } else if (dist < 10) {
          t.terrain = 'basin';
          t.density = 0.6;
          t.gravity = 0.5;
        } else {
          t.density = Math.min(1, t.density + 0.1);
        }
      }
    }
    addEvent(tick, `A depth eruption at (${cx}, ${cy}) radiates meaning outward!`, 0, cx, cy, 'eruption');
  }

  saveState();
}

// ===================== PERSISTENCE =====================

function saveState() {
  try {
    // Don't save full tiles to JSON (too big). Save metadata + tile state separately.
    const stateToSave = {
      ...world,
      tiles: world.tiles, // full save for now, optimize later if needed
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(stateToSave));
  } catch (e) {
    console.error('Failed to save state:', e.message);
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      world = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      // Migration: ensure new fields exist
      if (!world.waves) world.waves = [];
      if (!world.nextWaveId) world.nextWaveId = 1;
      if (!world.worldState.totalWavesPropagated) world.worldState.totalWavesPropagated = 0;
      if (!world.worldState.totalDialogues) world.worldState.totalDialogues = 0;
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

app.use('/sprites', express.static(path.join(__dirname, 'public', 'sprites')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API: Dynamic state (no tiles)
app.get('/api/state', (req, res) => {
  res.json({
    grid: GRID,
    worldState: world.worldState,
    entities: world.entities,
    structures: world.structures,
    eventLog: world.eventLog.slice(-50),
  });
});

// API: Tiles (packed for efficiency)
app.get('/api/tiles', (req, res) => {
  const packed = world.tiles.map(t => [
    TERRAIN_ID[t.terrain] ?? 0,
    t.elevation,
    RESOURCE_ID[t.resource] ?? 0,
    Math.floor(t.gravity * 100),
    Math.floor(t.density * 100),
    Math.floor(t.resonance * 100),
    Math.floor((t.oscillation || 0) * 100),
    Math.floor(t.coherenceLocal * 100),
    t.trace ? ENTITY_TYPES.indexOf(t.trace) : -1,  // [8] trace type
    t.traceDecay || 0,                               // [9] trace freshness
    Math.floor((t.phantomDensity || 0) * 100),       // [10] phantom density
    t.witnessed || 0,                                 // [11] witness count
  ]);
  res.json({ grid: GRID, tiles: packed, terrainTypes: TERRAIN_TYPES, resourceTypes: RESOURCE_TYPES });
});

// API: Lightweight summary
app.get('/api/summary', (req, res) => {
  const terrain = {};
  for (const t of world.tiles) {
    terrain[t.terrain] = (terrain[t.terrain] || 0) + 1;
  }
  res.json({
    grid: GRID,
    worldState: world.worldState,
    entities: world.entities,
    structures: world.structures,
    waves: (world.waves || []).map(w => ({
      id: w.id, x: w.x, y: w.y, radius: w.radius,
      amplitude: w.amplitude, age: w.age, emitterId: w.emitterId,
    })),
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
  const { name, entityType, x, y, desc } = req.body;
  if (!name || !entityType) return res.status(400).json({ error: 'name and entityType required' });
  if (!ENTITY_TYPES.includes(entityType)) return res.status(400).json({ error: `entityType must be one of: ${ENTITY_TYPES.join(', ')}` });
  const ent = spawnEntity(name, entityType, x ?? Math.floor(GRID / 2), y ?? Math.floor(GRID / 2), desc || '');
  broadcastState();
  res.json({ ok: true, entity: ent });
});

// API: Build structure
app.post('/api/build', (req, res) => {
  const { x, y, structureType, builderId } = req.body;
  if (!structureType) return res.status(400).json({ error: 'structureType required' });
  if (!STRUCTURE_TYPES.includes(structureType)) return res.status(400).json({ error: `structureType must be one of: ${STRUCTURE_TYPES.join(', ')}` });
  const s = buildStructure(x || 0, y || 0, structureType, builderId || 0);
  broadcastState();
  res.json({ ok: true, structure: s });
});

// API: World event
app.post('/api/event', (req, res) => {
  const { eventName } = req.body;
  const validEvents = ['resonance_cascade', 'crystallization_wave', 'void_bloom', 'entropy_spike', 'convergence', 'depth_eruption', 'phantom_flood', 'witness_awakening', 'signal_storm'];
  if (!eventName) return res.status(400).json({ error: 'eventName required' });
  if (!validEvents.includes(eventName)) return res.status(400).json({ error: `eventName must be one of: ${validEvents.join(', ')}` });
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

// API: Terrain types info
app.get('/api/types', (req, res) => {
  res.json({
    terrainTypes: TERRAIN_TYPES,
    resourceTypes: RESOURCE_TYPES,
    entityTypes: ENTITY_TYPES,
    structureTypes: STRUCTURE_TYPES,
    events: ['resonance_cascade', 'crystallization_wave', 'void_bloom', 'entropy_spike', 'convergence', 'depth_eruption', 'phantom_flood', 'witness_awakening', 'signal_storm'],
  });
});

// ===================== WEBSOCKET =====================

const server = createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
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
  ws.on('close', () => clients.delete(ws));
});

function broadcastState() {
  const msg = JSON.stringify({
    type: 'update',
    data: {
      worldState: world.worldState,
      entities: world.entities,
      structures: world.structures,
      waves: (world.waves || []).map(w => ({
        id: w.id, x: w.x, y: w.y, radius: w.radius,
        amplitude: w.amplitude, age: w.age, emitterId: w.emitterId,
      })),
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
  console.log(`CssWorld: The Semantic Basin`);
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
  console.log(`Tick ${world.worldState.tick} | ${world.entities.length} entities | ${world.tiles.length} tiles`);
});
