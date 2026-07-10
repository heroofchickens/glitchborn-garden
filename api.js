/**
 * Api: バックエンド切替アダプタ
 * FastAPIが居れば server モード（HTTP）、居なければ local モード（engine.js + localStorage）。
 * game.js はこのファサードだけを使う（fetchを直接書かない）。
 * 返り値の形は両モードで同一（ActionResult / BattleResult / MonsterState）。
 */
const Api = (() => {
  'use strict';
  let mode = 'local';

  async function init() {
    try {
      const res = await fetch('/api/species', { cache: 'no-store' });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('json')) { mode = 'server'; return mode; }
    } catch (e) { /* サーバー不在 → local */ }
    mode = 'local';
    return mode;
  }

  async function json(res) {
    try { return await res.json(); } catch (e) { return {}; }
  }

  /* ---- 参照系 ---- */
  async function species() {
    if (mode === 'local') return LocalEngine.speciesList();
    return json(await fetch('/api/species'));
  }

  async function getMonster(id) {
    if (mode === 'local') return LocalEngine.load(id);
    const res = await fetch(`/api/monster/${id}`);
    return res.ok ? json(res) : null;
  }

  async function listMonsters() {
    if (mode === 'local') return LocalEngine.listAll();
    const res = await fetch('/api/monsters');
    return res.ok ? json(res) : [];
  }

  /* ---- 更新系 ---- */
  async function createMonster(name) {
    if (mode === 'local') return LocalEngine.create(name);
    const res = await fetch('/api/monster', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error('create failed');
    return json(res);
  }

  async function deleteMonster(id) {
    if (mode === 'local') return LocalEngine.remove(id);
    const res = await fetch(`/api/monster/${id}`, { method: 'DELETE' });
    return res.ok;
  }

  /** act: feed / protein / train / clean / lights / medicine → ActionResult
   *  payload: train の {hits} など、エンジンに渡す追加パラメータ */
  async function action(id, act, payload) {
    if (mode === 'local') {
      const fn = LocalEngine.actions[act];
      return fn ? fn(id, payload) : { success: false, message: 'unknown action', state: null };
    }
    const opts = { method: 'POST' };
    if (payload) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(payload);
    }
    const res = await fetch(`/api/monster/${id}/${act}`, opts);
    const data = await json(res);
    if (!res.ok && data.success === undefined) {
      return { success: false, message: data.detail || 'エラー', state: null };
    }
    return data;
  }

  /** → {ok:true, result:BattleResult} | {ok:false, detail} */
  async function battle(id, strategy) {
    strategy = strategy || 'balanced';
    if (mode === 'local') return LocalEngine.battle(id, strategy);
    const res = await fetch(`/api/monster/${id}/battle`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy }),
    });
    const data = await json(res);
    if (!res.ok) return { ok: false, detail: data.detail || 'いまはバトルできない' };
    return { ok: true, result: data };
  }

  return {
    init, species, getMonster, listMonsters, createMonster, deleteMonster, action, battle,
    get mode() { return mode; },
  };
})();
