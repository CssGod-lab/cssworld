import { schema, table, t } from 'spacetimedb/server';

// ===================== TABLES =====================

const worldState = table(
  { name: 'world_state', public: true },
  {
    id: t.u64().primaryKey(),
    tick: t.u64(),
    season: t.string(),
    timeOfDay: t.string(),
    weather: t.string(),
    epoch: t.u64(),
  }
);

const tile = table(
  {
    name: 'tile',
    public: true,
    indexes: [
      { name: 'tile_x', algorithm: 'btree' as const, columns: ['x'] },
      { name: 'tile_y', algorithm: 'btree' as const, columns: ['y'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    x: t.i32(),
    y: t.i32(),
    terrain: t.string(),
    elevation: t.i32(),
    resource: t.string(),
    fertility: t.i32(),
  }
);

const entity = table(
  {
    name: 'entity',
    public: true,
    indexes: [
      { name: 'entity_x', algorithm: 'btree' as const, columns: ['x'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    x: t.i32(),
    y: t.i32(),
    entityType: t.string(),
    name: t.string(),
    state: t.string(),
    hp: t.i32(),
    energy: t.i32(),
    inventory: t.string(),
    direction: t.string(),
    createdAt: t.u64(),
  }
);

const structure = table(
  {
    name: 'structure',
    public: true,
    indexes: [
      { name: 'structure_x', algorithm: 'btree' as const, columns: ['x'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    x: t.i32(),
    y: t.i32(),
    structureType: t.string(),
    builderId: t.u64(),
    durability: t.i32(),
    createdAt: t.u64(),
  }
);

const eventLog = table(
  {
    name: 'event_log',
    public: true,
    indexes: [
      { name: 'event_log_tick', algorithm: 'btree' as const, columns: ['tick'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    tick: t.u64(),
    message: t.string(),
    entityId: t.u64(),
    x: t.i32(),
    y: t.i32(),
    eventType: t.string(),
    createdAt: t.u64(),
  }
);

// ===================== SCHEMA =====================

const spacetimedb = schema({ worldState, tile, entity, structure, eventLog });
export default spacetimedb;

// ===================== DETERMINISTIC PRNG =====================
// Reducers must be deterministic. We use a simple hash-based PRNG seeded by tick + position.

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h = (h ^ (h >>> 16)) | 0;
  return h;
}

// Perlin-ish noise for terrain generation using sin/cos heuristic
function noise2d(x: number, y: number, seed: number): number {
  const dot = x * 12.9898 + y * 78.233 + seed * 43758.5453;
  const s = Math.sin(dot) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // Smooth interpolation
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

function fbm(x: number, y: number, seed: number): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    val += amp * smoothNoise(x * freq * 0.1, y * freq * 0.1, seed + i * 100);
    amp *= 0.5;
    freq *= 2;
  }
  return val;
}

// ===================== REDUCERS =====================

export const init_world = spacetimedb.reducer((ctx) => {
  // Check if world already initialized
  const existing = ctx.db.worldState.id.find(1n);
  if (existing) {
    // Clear existing data for re-init
    ctx.db.worldState.id.delete(1n);
    for (const t of ctx.db.tile.iter()) {
      ctx.db.tile.id.delete(t.id);
    }
    for (const e of ctx.db.entity.iter()) {
      ctx.db.entity.id.delete(e.id);
    }
    for (const s of ctx.db.structure.iter()) {
      ctx.db.structure.id.delete(s.id);
    }
    for (const ev of ctx.db.eventLog.iter()) {
      ctx.db.eventLog.id.delete(ev.id);
    }
  }

  // Create world state
  ctx.db.worldState.insert({
    id: 1n,
    tick: 0n,
    season: 'spring',
    timeOfDay: 'day',
    weather: 'clear',
    epoch: 0n,
  });

  const SEED = 42;

  // Generate 32x32 tile grid
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const heightVal = fbm(x, y, SEED);
      const moistureVal = fbm(x, y, SEED + 500);
      const elevation = Math.floor(heightVal * 10);

      let terrain: string;
      if (heightVal < 0.25) {
        terrain = 'water';
      } else if (heightVal < 0.32) {
        terrain = 'sand';
      } else if (heightVal > 0.75) {
        terrain = 'mountain';
      } else if (heightVal > 0.65) {
        terrain = 'rock';
      } else if (moistureVal > 0.6) {
        terrain = 'forest';
      } else if (moistureVal > 0.5 && heightVal < 0.4) {
        terrain = 'swamp';
      } else {
        terrain = 'grass';
      }

      // Determine resource
      const resNoise = noise2d(x * 3.7, y * 2.3, SEED + 1000);
      let resource = 'none';
      if (resNoise > 0.85) {
        if (terrain === 'forest') resource = 'wood';
        else if (terrain === 'rock' || terrain === 'mountain') resource = 'stone';
        else if (terrain === 'grass') resource = 'herb';
        else if (terrain === 'swamp') resource = 'crystal';
      }

      // Fertility based on terrain
      let fertility = 50;
      if (terrain === 'grass') fertility = 70 + Math.floor(moistureVal * 30);
      else if (terrain === 'forest') fertility = 60 + Math.floor(moistureVal * 20);
      else if (terrain === 'water') fertility = 10;
      else if (terrain === 'sand') fertility = 15;
      else if (terrain === 'rock') fertility = 5;
      else if (terrain === 'mountain') fertility = 0;
      else if (terrain === 'swamp') fertility = 40;

      ctx.db.tile.insert({
        id: 0n,
        x,
        y,
        terrain,
        elevation,
        resource,
        fertility,
      });
    }
  }

  // Log event
  ctx.db.eventLog.insert({
    id: 0n,
    tick: 0n,
    message: 'World initialized: 32x32 grid generated',
    entityId: 0n,
    x: 0,
    y: 0,
    eventType: 'discovery',
    createdAt: 0n,
  });

  // Spawn initial entities
  const initialEntities = [
    { name: 'Aria the Wanderer', entityType: 'wanderer', x: 8, y: 8 },
    { name: 'Kael the Builder', entityType: 'builder', x: 16, y: 16 },
    { name: 'Fern the Gatherer', entityType: 'gatherer', x: 24, y: 8 },
    { name: 'Thane the Guardian', entityType: 'guardian', x: 16, y: 24 },
  ];

  for (const e of initialEntities) {
    ctx.db.entity.insert({
      id: 0n,
      x: e.x,
      y: e.y,
      entityType: e.entityType,
      name: e.name,
      state: 'idle',
      hp: 100,
      energy: 100,
      inventory: '{}',
      direction: 'n',
      createdAt: 0n,
    });

    ctx.db.eventLog.insert({
      id: 0n,
      tick: 0n,
      message: `${e.name} appeared at (${e.x}, ${e.y})`,
      entityId: 0n,
      x: e.x,
      y: e.y,
      eventType: 'spawn',
      createdAt: 0n,
    });
  }
});

export const advance_tick = spacetimedb.reducer((ctx) => {
  const ws = ctx.db.worldState.id.find(1n);
  if (!ws) return;

  const newTick = ws.tick + 1n;
  const tickNum = Number(newTick);

  // Time of day cycle: every 24 ticks
  const times = ['dawn', 'day', 'dusk', 'night'];
  const timeIndex = Math.floor(tickNum / 24) % 4;
  const newTime = times[timeIndex];

  // Season cycle: every 96 ticks
  const seasons = ['spring', 'summer', 'autumn', 'winter'];
  const seasonIndex = Math.floor(tickNum / 96) % 4;
  const newSeason = seasons[seasonIndex];

  // Weather changes (deterministic based on tick)
  const weatherRng = mulberry32(hashSeed(tickNum, 777, 0));
  const weatherRoll = weatherRng();
  let newWeather = ws.weather;
  if (weatherRoll < 0.15) {
    const weathers = ['clear', 'rain', 'fog', 'storm'];
    const wIdx = Math.floor(weatherRng() * 4);
    newWeather = weathers[wIdx];
  }

  // Epoch increments every 384 ticks (4 full season cycles)
  const newEpoch = BigInt(Math.floor(tickNum / 384));

  // Log time/season/weather changes
  if (newTime !== ws.timeOfDay) {
    ctx.db.eventLog.insert({
      id: 0n, tick: newTick, message: `Time changed to ${newTime}`,
      entityId: 0n, x: 0, y: 0, eventType: 'weather', createdAt: newTick,
    });
  }
  if (newSeason !== ws.season) {
    ctx.db.eventLog.insert({
      id: 0n, tick: newTick, message: `Season changed to ${newSeason}`,
      entityId: 0n, x: 0, y: 0, eventType: 'weather', createdAt: newTick,
    });
  }
  if (newWeather !== ws.weather) {
    ctx.db.eventLog.insert({
      id: 0n, tick: newTick, message: `Weather changed to ${newWeather}`,
      entityId: 0n, x: 0, y: 0, eventType: 'weather', createdAt: newTick,
    });
  }

  // Update world state
  ctx.db.worldState.id.update({
    ...ws,
    tick: newTick,
    season: newSeason,
    timeOfDay: newTime,
    weather: newWeather,
    epoch: newEpoch,
  });

  // Move entities
  const entities = [...ctx.db.entity.iter()];
  const dirs = [
    { d: 'n', dx: 0, dy: -1 },
    { d: 's', dx: 0, dy: 1 },
    { d: 'e', dx: 1, dy: 0 },
    { d: 'w', dx: -1, dy: 0 },
  ];

  for (const ent of entities) {
    const rng = mulberry32(hashSeed(tickNum, Number(ent.id), 42));

    // Energy regen during night/sleeping
    let newEnergy = ent.energy;
    let newState = ent.state;
    let newHp = ent.hp;

    if (newTime === 'night' && rng() < 0.6) {
      newState = 'sleeping';
      newEnergy = Math.min(100, newEnergy + 10);
    } else if (newEnergy < 20) {
      newState = 'idle';
      newEnergy = Math.min(100, newEnergy + 5);
    } else {
      // Move
      const moveRoll = rng();
      if (moveRoll < 0.7) {
        const dirIdx = Math.floor(rng() * 4);
        const dir = dirs[dirIdx];
        const newX = Math.max(0, Math.min(31, ent.x + dir.dx));
        const newY = Math.max(0, Math.min(31, ent.y + dir.dy));

        // Check terrain at destination
        let canMove = true;
        for (const t of ctx.db.tile.iter()) {
          if (t.x === newX && t.y === newY) {
            if (t.terrain === 'water' && ent.entityType !== 'wanderer') {
              canMove = false;
            }
            // Gatherer gathers resources
            if (canMove && ent.entityType === 'gatherer' && t.resource !== 'none') {
              newState = 'gathering';
              const inv = JSON.parse(ent.inventory || '{}');
              inv[t.resource] = (inv[t.resource] || 0) + 1;
              ctx.db.entity.id.update({
                ...ent,
                x: newX,
                y: newY,
                direction: dir.d,
                state: newState,
                energy: Math.max(0, newEnergy - 3),
                hp: newHp,
                inventory: JSON.stringify(inv),
              });
              ctx.db.eventLog.insert({
                id: 0n, tick: newTick,
                message: `${ent.name} gathered ${t.resource} at (${newX}, ${newY})`,
                entityId: ent.id, x: newX, y: newY,
                eventType: 'gather', createdAt: newTick,
              });
              canMove = false; // Already updated
            }
            break;
          }
        }

        if (canMove) {
          newState = 'moving';
          ctx.db.entity.id.update({
            ...ent,
            x: newX,
            y: newY,
            direction: dir.d,
            state: newState,
            energy: Math.max(0, newEnergy - 2),
            hp: newHp,
          });
          if (rng() < 0.1) {
            ctx.db.eventLog.insert({
              id: 0n, tick: newTick,
              message: `${ent.name} moved ${dir.d} to (${newX}, ${newY})`,
              entityId: ent.id, x: newX, y: newY,
              eventType: 'move', createdAt: newTick,
            });
          }
          continue; // Skip the update below
        }
      } else {
        newState = 'idle';
      }
    }

    // Only update if not already updated by gather/move
    if (ent.state !== newState || ent.energy !== newEnergy) {
      ctx.db.entity.id.update({
        ...ent,
        state: newState,
        energy: newEnergy,
        hp: newHp,
      });
    }
  }

  // Decay structures
  const structures = [...ctx.db.structure.iter()];
  for (const s of structures) {
    const newDur = s.durability - 1;
    if (newDur <= 0) {
      ctx.db.eventLog.insert({
        id: 0n, tick: newTick,
        message: `${s.structureType} at (${s.x}, ${s.y}) crumbled`,
        entityId: s.builderId, x: s.x, y: s.y,
        eventType: 'build', createdAt: newTick,
      });
      ctx.db.structure.id.delete(s.id);
    } else {
      ctx.db.structure.id.update({ ...s, durability: newDur });
    }
  }
});

export const spawn_entity = spacetimedb.reducer(
  { name: t.string(), entityType: t.string(), x: t.i32(), y: t.i32() },
  (ctx, { name, entityType, x, y }) => {
    const ws = ctx.db.worldState.id.find(1n);
    const tick = ws ? ws.tick : 0n;

    const row = ctx.db.entity.insert({
      id: 0n,
      x,
      y,
      entityType,
      name,
      state: 'idle',
      hp: 100,
      energy: 100,
      inventory: '{}',
      direction: 'n',
      createdAt: tick,
    });

    ctx.db.eventLog.insert({
      id: 0n,
      tick,
      message: `${name} (${entityType}) spawned at (${x}, ${y})`,
      entityId: row.id,
      x,
      y,
      eventType: 'spawn',
      createdAt: tick,
    });
  }
);

export const build_structure = spacetimedb.reducer(
  { x: t.i32(), y: t.i32(), structureType: t.string(), builderId: t.u64() },
  (ctx, { x, y, structureType, builderId }) => {
    const ws = ctx.db.worldState.id.find(1n);
    const tick = ws ? ws.tick : 0n;

    const durabilities: Record<string, number> = {
      campfire: 50,
      tower: 200,
      bridge: 150,
      shrine: 300,
      wall: 250,
      garden: 80,
    };

    const row = ctx.db.structure.insert({
      id: 0n,
      x,
      y,
      structureType,
      builderId,
      durability: durabilities[structureType] || 100,
      createdAt: tick,
    });

    // Find builder name
    const builder = ctx.db.entity.id.find(builderId);
    const builderName = builder ? builder.name : `Entity #${builderId}`;

    ctx.db.eventLog.insert({
      id: 0n,
      tick,
      message: `${builderName} built a ${structureType} at (${x}, ${y})`,
      entityId: builderId,
      x,
      y,
      eventType: 'build',
      createdAt: tick,
    });
  }
);

export const world_event = spacetimedb.reducer(
  { eventName: t.string() },
  (ctx, { eventName }) => {
    const ws = ctx.db.worldState.id.find(1n);
    if (!ws) return;
    const tick = ws.tick;
    const tickNum = Number(tick);
    const rng = mulberry32(hashSeed(tickNum, 9999, eventName.length));

    if (eventName === 'meteor') {
      // Meteor strike: change a random area to rock
      const mx = Math.floor(rng() * 32);
      const my = Math.floor(rng() * 32);
      for (const t of ctx.db.tile.iter()) {
        const dx = Math.abs(t.x - mx);
        const dy = Math.abs(t.y - my);
        if (dx + dy <= 2) {
          ctx.db.tile.id.update({ ...t, terrain: 'rock', resource: 'stone', elevation: 8 });
        }
      }
      ctx.db.eventLog.insert({
        id: 0n, tick, message: `A meteor struck near (${mx}, ${my})!`,
        entityId: 0n, x: mx, y: my, eventType: 'discovery', createdAt: tick,
      });
    } else if (eventName === 'earthquake') {
      // Earthquake: shift elevations, some terrain changes
      for (const t of ctx.db.tile.iter()) {
        if (rng() < 0.15) {
          const newElev = Math.max(0, Math.min(10, t.elevation + Math.floor(rng() * 5) - 2));
          let newTerrain = t.terrain;
          if (newElev >= 8 && t.terrain !== 'water') newTerrain = 'mountain';
          else if (newElev <= 1 && t.terrain !== 'mountain') newTerrain = 'swamp';
          ctx.db.tile.id.update({ ...t, elevation: newElev, terrain: newTerrain });
        }
      }
      ctx.db.eventLog.insert({
        id: 0n, tick, message: 'An earthquake shook the land!',
        entityId: 0n, x: 16, y: 16, eventType: 'discovery', createdAt: tick,
      });
    } else if (eventName === 'migration') {
      // Spawn several new entities
      const types = ['wanderer', 'builder', 'gatherer', 'guardian'];
      const names = ['Nova', 'Elm', 'Sage', 'Flint', 'Coral'];
      for (let i = 0; i < 3; i++) {
        const etype = types[Math.floor(rng() * 4)];
        const ename = names[Math.floor(rng() * 5)] + ' the ' + etype.charAt(0).toUpperCase() + etype.slice(1);
        const ex = Math.floor(rng() * 32);
        const ey = Math.floor(rng() * 32);
        const row = ctx.db.entity.insert({
          id: 0n, x: ex, y: ey, entityType: etype, name: ename,
          state: 'idle', hp: 100, energy: 100, inventory: '{}', direction: 'n', createdAt: tick,
        });
        ctx.db.eventLog.insert({
          id: 0n, tick, message: `${ename} arrived during migration at (${ex}, ${ey})`,
          entityId: row.id, x: ex, y: ey, eventType: 'spawn', createdAt: tick,
        });
      }
    } else if (eventName === 'blessing') {
      // Blessing: heal all entities and boost fertility
      const entities = [...ctx.db.entity.iter()];
      for (const ent of entities) {
        ctx.db.entity.id.update({ ...ent, hp: 100, energy: 100 });
      }
      // Boost grass fertility
      for (const t of ctx.db.tile.iter()) {
        if (t.terrain === 'grass' || t.terrain === 'forest') {
          ctx.db.tile.id.update({ ...t, fertility: Math.min(100, t.fertility + 20) });
        }
      }
      ctx.db.eventLog.insert({
        id: 0n, tick, message: 'A divine blessing washed over the land!',
        entityId: 0n, x: 16, y: 16, eventType: 'discovery', createdAt: tick,
      });
    }
  }
);
