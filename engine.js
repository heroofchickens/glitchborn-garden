/**
 * LocalEngine: src/*.py のゲームロジック完全移植（静的ホスティング用）
 * 永続化は localStorage。時間はUNIX秒で扱い、Python版とデータ互換の決定論的Tick。
 * サーバーが居る時は使われない（api.js が自動切替）。
 */
const LocalEngine = (() => {
  'use strict';

  /* ============ config (src/config.py) ============ */
  const NORMAL_INTERVALS = {
    hunger_interval: 3600,
    strength_interval: 5400,
    poop_interval: 7200,
    egg_hatch_time: 300,
    evolution_time: 3600,
    care_call_timeout: 1200,
    sleep_duration: 28800,
  };

  function isDev() {
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('dev') === '1') { localStorage.setItem('dm_dev', '1'); return true; }
      if (q.get('dev') === '0') { localStorage.removeItem('dm_dev'); return false; }
      return localStorage.getItem('dm_dev') === '1';
    } catch (e) { return false; }
  }

  const CFG = {};
  {
    const div = isDev() ? 60 : 1;
    for (const [k, v] of Object.entries(NORMAL_INTERVALS)) CFG[k] = Math.max(1, Math.floor(v / div));
  }

  /* ============ species (src/species.py) ============ */
  const SPECIES_DB = {
    digitama:       { name: 'デジタマ',           stage: 'egg',     type: 'neutral', base_stamina: 0,  base_weight: 5,  sprite_id: 'digitama' },
    slime:          { name: 'スライム',           stage: 'baby',    type: 'neutral', base_stamina: 10, base_weight: 10, sprite_id: 'slime' },
    blaze_kid:      { name: 'ブレイズキッド',     stage: 'child',   type: 'blaze',   base_stamina: 15, base_weight: 20, sprite_id: 'blaze_kid' },
    shadow_kid:     { name: 'シャドウキッド',     stage: 'child',   type: 'shadow',  base_stamina: 15, base_weight: 18, sprite_id: 'shadow_kid' },
    gale_kid:       { name: 'ゲイルキッド',       stage: 'child',   type: 'gale',    base_stamina: 15, base_weight: 16, sprite_id: 'gale_kid' },
    numemon:        { name: 'ヌメモン',           stage: 'child',   type: 'neutral', base_stamina: 10, base_weight: 25, sprite_id: 'numemon' },
    blaze_warrior:  { name: 'ブレイズウォリアー', stage: 'adult',   type: 'blaze',   base_stamina: 20, base_weight: 35, sprite_id: 'blaze_warrior' },
    shadow_warrior: { name: 'シャドウウォリアー', stage: 'adult',   type: 'shadow',  base_stamina: 20, base_weight: 30, sprite_id: 'shadow_warrior' },
    gale_warrior:   { name: 'ゲイルウォリアー',   stage: 'adult',   type: 'gale',    base_stamina: 20, base_weight: 28, sprite_id: 'gale_warrior' },
    dark_warrior:   { name: 'ダークウォリアー',   stage: 'adult',   type: 'neutral', base_stamina: 18, base_weight: 40, sprite_id: 'dark_warrior' },
    blaze_lord:     { name: 'ブレイズロード',     stage: 'perfect', type: 'blaze',   base_stamina: 25, base_weight: 50, sprite_id: 'blaze_lord' },
    shadow_lord:    { name: 'シャドウロード',     stage: 'perfect', type: 'shadow',  base_stamina: 25, base_weight: 45, sprite_id: 'shadow_lord' },
    gale_lord:      { name: 'ゲイルロード',       stage: 'perfect', type: 'gale',    base_stamina: 25, base_weight: 42, sprite_id: 'gale_lord' },
  };

  function speciesList() {
    return Object.entries(SPECIES_DB).map(([id, d]) => ({
      id, name: d.name, stage: d.stage, monster_type: d.type,
      base_stamina: d.base_stamina, base_weight: d.base_weight, sprite_id: d.sprite_id,
    }));
  }

  /* ============ evolution (src/evolution.py) ============ */
  const RANDOM_CHILDREN = ['blaze_kid', 'shadow_kid', 'gale_kid'];
  const STAGE_RANK = { egg: 0, baby: 1, child: 2, adult: 3, perfect: 4 };

  function winRate(m) { return m.battles_fought === 0 ? 0 : m.battles_won / m.battles_fought; }

  const EVOLUTION_PATHS = {
    digitama: [[() => true, 'slime']],
    slime: [
      [m => m.care_misses <= 3, '_random_child'],
      [() => true, 'numemon'],
    ],
    blaze_kid: [[m => m.care_misses <= 3, 'blaze_warrior'], [() => true, 'dark_warrior']],
    shadow_kid: [[m => m.care_misses <= 3, 'shadow_warrior'], [() => true, 'dark_warrior']],
    gale_kid: [[m => m.care_misses <= 3, 'gale_warrior'], [() => true, 'dark_warrior']],
    blaze_warrior: [[m => m.battles_fought >= 15 && winRate(m) >= 0.6, 'blaze_lord']],
    shadow_warrior: [[m => m.battles_fought >= 15 && winRate(m) >= 0.6, 'shadow_lord']],
    gale_warrior: [[m => m.battles_fought >= 15 && winRate(m) >= 0.6, 'gale_lord']],
  };

  function checkEvolution(m) {
    const paths = EVOLUTION_PATHS[m.species_id];
    if (!paths) return null;
    for (const [cond, target] of paths) {
      if (cond(m)) {
        return target === '_random_child'
          ? RANDOM_CHILDREN[Math.floor(Math.random() * RANDOM_CHILDREN.length)]
          : target;
      }
    }
    return null;
  }

  /* ============ battle (src/battle.py) ============ */
  const TYPE_ADVANTAGE = { blaze: 'shadow', shadow: 'gale', gale: 'blaze' };
  const STRATEGIES = ['aggressive', 'balanced', 'defensive'];
  const STRATEGY_ADVANTAGE = { aggressive: 'defensive', defensive: 'balanced', balanced: 'aggressive' };

  function typeBonus(a, d) {
    if (TYPE_ADVANTAGE[a] === d) return 0.30;
    if (TYPE_ADVANTAGE[d] === a) return -0.30;
    return 0.0;
  }

  function strategyBonus(a, d) {
    if (STRATEGY_ADVANTAGE[a] === d) return 0.15;
    if (STRATEGY_ADVANTAGE[d] === a) return -0.15;
    return 0.0;
  }

  function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

  function calcPower(m) {
    const base = m.strength * 10 + m.weight;
    return Math.max(1, base + randInt(-5, 15));
  }

  function resolveRound(player, opp, strategyMod) {
    let pPower = calcPower(player);
    const oPower = calcPower(opp);
    const mod = typeBonus(player.monster_type, opp.monster_type)
      + (STAGE_RANK[player.stage] - STAGE_RANK[opp.stage]) * 0.15
      + (player.strength - opp.strength) * 0.05
      + (strategyMod || 0);
    pPower = Math.floor(pPower * (1 + mod));
    return { round_num: 0, player_power: pPower, opponent_power: oPower, player_won: pPower >= oPower };
  }

  function generateCpuOpponent(player) {
    let candidates = Object.entries(SPECIES_DB).filter(([, d]) => d.stage === player.stage);
    if (!candidates.length) candidates = Object.entries(SPECIES_DB).filter(([, d]) => d.stage === 'child');
    const [sid, sp] = candidates[Math.floor(Math.random() * candidates.length)];
    return {
      id: 'cpu_' + randInt(1000, 9999),
      name: sp.name, species_id: sid, stage: sp.stage, monster_type: sp.type,
      hunger: randInt(2, 4), strength: randInt(1, 4),
      weight: sp.base_weight + randInt(-3, 5),
      stamina: sp.base_stamina, max_stamina: sp.base_stamina,
    };
  }

  function resolveBattle(player, opponent, strategy) {
    const opp = opponent || generateCpuOpponent(player);
    strategy = STRATEGIES.includes(strategy) ? strategy : 'balanced';
    const opponentStrategy = STRATEGIES[Math.floor(Math.random() * STRATEGIES.length)];
    const strategyMod = strategyBonus(strategy, opponentStrategy);
    const rounds = [];
    let pWins = 0, oWins = 0;
    for (let i = 0; i < 5; i++) {
      if (pWins >= 3 || oWins >= 3) break;
      const r = resolveRound(player, opp, strategyMod);
      r.round_num = i + 1;
      rounds.push(r);
      if (r.player_won) pWins++; else oWins++;
    }
    return {
      won: pWins > oWins, rounds, total_rounds: rounds.length,
      player_wins: pWins, opponent_wins: oWins,
      opponent_name: opp.name, opponent_species: opp.species_id,
      player_strategy: strategy, opponent_strategy: opponentStrategy,
      weight_change: -4,
    };
  }

  /* ============ engine (src/monster.py) ============ */
  const STORE_KEY = 'dm_local_monsters';

  function now() { return Date.now() / 1000; }

  function loadAllRaw() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveAllRaw(map) { localStorage.setItem(STORE_KEY, JSON.stringify(map)); }

  function save(m) {
    m.last_save = now();
    const map = loadAllRaw();
    map[m.id] = m;
    saveAllRaw(map);
  }

  function newId() {
    const hex = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < 8; i++) s += hex[Math.floor(Math.random() * 16)];
    return s;
  }

  function create(name) {
    const t = now();
    const m = {
      id: newId(), name, species_id: 'digitama', stage: 'egg', monster_type: 'neutral',
      hunger: 4, strength: 0, weight: 5, stamina: 10, max_stamina: 10,
      sick: false, sleeping: false, lights_on: true, alive: true,
      poop_count: 0, care_misses: 0, care_call_active: false, care_call_time: null,
      battles_fought: 0, battles_won: 0,
      born_at: t, last_hunger_tick: t, last_strength_tick: t, last_poop_tick: t,
      last_evolution_check: t, sleep_start: null, last_save: 0, stage_started_at: t,
    };
    save(m);
    return m;
  }

  function evolve(m, t, target) {
    if (target == null) target = checkEvolution(m);
    if (target == null) return;
    const sp = SPECIES_DB[target];
    if (!sp) return;
    m.species_id = target;
    m.stage = sp.stage;
    m.monster_type = sp.type;
    m.max_stamina = sp.base_stamina;
    m.stamina = sp.base_stamina;
    m.weight = sp.base_weight;
    m.stage_started_at = t;
  }

  function wakeUp(m) {
    m.sleeping = false;
    m.sleep_start = null;
    m.stamina = m.max_stamina;
    m.lights_on = true;
  }

  function checkCareCall(m, t) {
    const needsCare = m.hunger === 0 || m.poop_count >= 4;
    if (needsCare && !m.care_call_active) {
      m.care_call_active = true;
      m.care_call_time = t;
    } else if (needsCare && m.care_call_active && m.care_call_time != null) {
      if (t - m.care_call_time >= CFG.care_call_timeout) {
        m.care_misses += 1;
        m.care_call_active = false;
        m.care_call_time = null;
      }
    } else if (!needsCare) {
      m.care_call_active = false;
      m.care_call_time = null;
    }
  }

  function processTicks(m) {
    if (!m.alive) return;
    const t = now();

    if (m.sleeping && m.sleep_start != null) {
      if (t - m.sleep_start >= CFG.sleep_duration) wakeUp(m);
      else return;
    }

    if (m.stage === 'egg') {
      if (t - m.stage_started_at >= CFG.egg_hatch_time) evolve(m, t);
      return;
    }

    const hungerTicks = Math.floor((t - m.last_hunger_tick) / CFG.hunger_interval);
    if (hungerTicks > 0) {
      m.hunger = Math.max(0, m.hunger - hungerTicks);
      m.last_hunger_tick += hungerTicks * CFG.hunger_interval;
    }

    const strengthTicks = Math.floor((t - m.last_strength_tick) / CFG.strength_interval);
    if (strengthTicks > 0) {
      m.strength = Math.max(0, m.strength - strengthTicks);
      m.last_strength_tick += strengthTicks * CFG.strength_interval;
    }

    const poopTicks = Math.floor((t - m.last_poop_tick) / CFG.poop_interval);
    if (poopTicks > 0) {
      m.poop_count = Math.min(8, m.poop_count + poopTicks);
      m.last_poop_tick += poopTicks * CFG.poop_interval;
    }

    checkCareCall(m, t);

    if (m.poop_count >= 5 && !m.sick) m.sick = true;

    if (t - m.last_evolution_check >= CFG.evolution_time) {
      const target = checkEvolution(m);
      if (target) evolve(m, t, target);
      m.last_evolution_check = t;
    }

    if (m.hunger === 0 && m.care_misses >= 10) m.alive = false;
  }

  function load(id) {
    const map = loadAllRaw();
    const m = map[id];
    if (!m) return null;
    processTicks(m);
    save(m);
    return m;
  }

  function listAll() {
    return Object.keys(loadAllRaw()).map(id => load(id)).filter(Boolean);
  }

  function remove(id) {
    const map = loadAllRaw();
    if (!(id in map)) return false;
    delete map[id];
    saveAllRaw(map);
    return true;
  }

  /* ============ actions（メッセージはフロント調のひらがなで統一） ============ */
  const ok = (message, state) => ({ success: true, message, state });
  const ng = (message, state) => ({ success: false, message, state: state || null });

  function guardAwake(m) {
    if (!m.alive) return 'おほしさまになっている…';
    if (m.sleeping) return 'すやすや ねている…';
    if (m.stage === 'egg') return 'まだタマゴだよ';
    return null;
  }

  const actions = {
    feed(id) {
      const m = load(id);
      if (!m) return ng('モンスターが見つからない');
      const g = guardAwake(m); if (g) return ng(g, m);
      if (m.hunger >= 4) return ng('おなかいっぱい みたい', m);
      m.hunger = Math.min(4, m.hunger + 1);
      m.weight = Math.min(99, m.weight + 1);
      save(m);
      return ok('ごはんをあげた！', m);
    },
    protein(id) {
      const m = load(id);
      if (!m) return ng('モンスターが見つからない');
      const g = guardAwake(m); if (g) return ng(g, m);
      m.strength = Math.min(4, m.strength + 1);
      m.weight = Math.min(99, m.weight + 2);
      save(m);
      return ok('プロテインをあげた！', m);
    },
    train(id, payload) {
      const m = load(id);
      if (!m) return ng('モンスターが見つからない');
      const g = guardAwake(m); if (g) return ng(g, m);
      if (m.stamina < 1) return ng('スタミナがたりない…', m);
      // ミニゲーム成績で効果が変わる（hits未指定=API直叩きは従来通り+1）
      const hits = payload && Number.isInteger(payload.hits) ? payload.hits : null;
      const gain = hits === null ? 1 : (hits >= 3 ? 2 : (hits >= 1 ? 1 : 0));
      m.strength = Math.min(4, m.strength + gain);
      m.weight = Math.max(1, m.weight - 2);
      m.stamina = Math.max(0, m.stamina - 1);
      save(m);
      const msg = hits === null ? 'トレーニングした！'
        : hits >= 3 ? 'パーフェクト！💯 きんりょくが ぐんぐん上がった！'
        : hits >= 1 ? `${hits}かいヒット！きんりょくが上がった`
        : 'しっぱい… あせだけ かいた';
      return ok(msg, m);
    },
    clean(id) {
      const m = load(id);
      if (!m) return ng('モンスターが見つからない');
      if (m.poop_count === 0) return ng('そうじのひつようは なさそう', m);
      m.poop_count = 0;
      save(m);
      return ok('ピカピカにした！', m);
    },
    lights(id) {
      const m = load(id);
      if (!m) return ng('モンスターが見つからない');
      if (!m.alive) return ng('おほしさまになっている…', m);
      if (m.lights_on) {
        m.lights_on = false;
        m.sleeping = true;
        m.sleep_start = now();
        save(m);
        return ok('おやすみなさい…', m);
      }
      m.lights_on = true;
      m.sleeping = false;
      m.sleep_start = null;
      save(m);
      return ok('おはよう！', m);
    },
    medicine(id) {
      const m = load(id);
      if (!m) return ng('モンスターが見つからない');
      if (!m.sick) return ng('びょうきじゃ ないみたい', m);
      m.sick = false;
      save(m);
      return ok('げんきになった！', m);
    },
  };

  /* battle (src/api.py の do_battle 相当) */
  function battle(id, strategy) {
    const player = load(id);
    if (!player) return { ok: false, detail: 'モンスターが見つからない' };
    if (!player.alive) return { ok: false, detail: 'おほしさまになっている…' };
    if (player.sleeping) return { ok: false, detail: 'すやすや ねている…' };
    if (player.stage === 'egg' || player.stage === 'baby') return { ok: false, detail: 'まだ ちいさすぎる' };
    if (player.stamina < 1) return { ok: false, detail: 'スタミナがたりない…' };

    const result = resolveBattle(player, null, strategy || 'balanced');
    if (result.won) player.battles_won += 1;
    player.battles_fought += 1;
    player.weight = Math.max(1, player.weight - 4);
    player.stamina = Math.max(0, player.stamina - 2);
    save(player);
    return { ok: true, result };
  }

  return {
    isDev, speciesList, create, load, listAll, remove, actions, battle,
    _internals: { CFG, processTicks, checkEvolution, resolveBattle, resolveRound, strategyBonus },  // テスト用
  };
})();
