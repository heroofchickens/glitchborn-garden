/**
 * ゲームコントローラ: 状態ポーリング + HTML UI + Stage3D演出の配線
 * 描画は stage3d.js (Stage.*)、状態の真実源は Api（サーバー or ローカルエンジンを自動切替）。
 */
const Game = {
  currentMonster: null,
  prevMonster: null,
  monsterId: null,
  speciesMap: {},   // id -> {name, stage, monster_type}
  actionLock: false,

  STAGE_JP: { egg: 'タマゴ', baby: 'ベビー', child: 'チャイルド', adult: 'アダルト', perfect: 'パーフェクト' },
  PUBLIC_URL: 'https://heroofchickens.github.io/glitchborn-garden/',
  ZUKAN_EMOJI: {
    digitama: '🥚', slime: '🫠', numemon: '🐌', dark_warrior: '🌑',
    blaze_kid: '🔥', blaze_warrior: '🔥', blaze_lord: '🔥',
    shadow_kid: '🦊', shadow_warrior: '🦊', shadow_lord: '🦊',
    gale_kid: '🕊️', gale_warrior: '🕊️', gale_lord: '🕊️',
  },
  speciesList: [],

  async init() {
    Stage.init(document.getElementById('stage'));
    Stage.onPet = () => this.pet();
    Achievements.setUnlockHandler(a => {
      SFX.play('born');
      this.toast(`🏅 実績解除！ ${a.emoji}${a.name}\n称号「${a.title}」`, 4200);
    });
    window.addEventListener('pointerdown', () => SFX.unlock(), { once: true });

    document.querySelectorAll('#actions button').forEach(b => {
      b.addEventListener('click', () => { SFX.play('click'); this.onAction(b.dataset.act); });
    });
    document.getElementById('create-ok').addEventListener('click', () => this.createMonster());
    document.getElementById('monster-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.createMonster();
    });
    // 既にモンスターがいる場合は背景クリックで作成ダイアログを閉じられる
    document.getElementById('create-dialog').addEventListener('click', e => {
      if (e.target.id === 'create-dialog' && this.currentMonster) {
        document.getElementById('create-dialog').classList.add('hidden');
      }
    });
    document.getElementById('restart-btn').addEventListener('click', () => this.restartFromEgg());
    document.getElementById('btn-switch').addEventListener('click', () => { SFX.play('click'); this.openSwitcher(); });
    document.getElementById('btn-zukan').addEventListener('click', () => { SFX.play('click'); this.openZukan(); });
    document.getElementById('zukan-close').addEventListener('click', () => document.getElementById('zukan-overlay').classList.add('hidden'));
    document.getElementById('btn-share').addEventListener('click', () => { SFX.play('click'); this.share(); });
    document.getElementById('btn-achievements').addEventListener('click', () => { SFX.play('click'); this.openAchievements(); });
    document.getElementById('achievements-close').addEventListener('click', () => document.getElementById('achievements-overlay').classList.add('hidden'));
    document.querySelectorAll('[data-strategy]').forEach(b => b.addEventListener('click', () => {
      SFX.play('click');
      document.getElementById('strategy-overlay').classList.add('hidden');
      this.doBattle(b.dataset.strategy);
    }));
    document.getElementById('strategy-cancel').addEventListener('click', () => document.getElementById('strategy-overlay').classList.add('hidden'));
    document.getElementById('switch-close').addEventListener('click', () => document.getElementById('switch-overlay').classList.add('hidden'));
    document.getElementById('switch-new').addEventListener('click', () => {
      document.getElementById('switch-overlay').classList.add('hidden');
      document.getElementById('create-dialog').classList.remove('hidden');
      document.getElementById('monster-name').value = '';
      document.getElementById('monster-name').focus();
    });
    document.getElementById('title-start').addEventListener('click', () => {
      SFX.unlock(); SFX.play('click');
      document.getElementById('title-overlay').classList.add('hidden');
      document.getElementById('create-dialog').classList.remove('hidden');
      document.getElementById('monster-name').focus();
    });
    document.getElementById('train-stop').addEventListener('click', () => this.trainPress());
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && this.train.active) { e.preventDefault(); this.trainPress(); }
    });

    await Api.init();
    await this.loadSpecies();
    await this.loadExistingMonster();
    if (!this.currentMonster) {
      // はじめての人にはタイトル画面から
      document.getElementById('title-overlay').classList.remove('hidden');
    } else {
      this.applyState(this.currentMonster, null);
    }
    setInterval(() => this.pollState(), 3000);
    this.startTrainLoop();
  },

  async loadSpecies() {
    try {
      const list = await Api.species();
      this.speciesList = list;
      for (const s of list) this.speciesMap[s.id] = s;
    } catch (e) { }
  },

  speciesName(id) { return (this.speciesMap[id] || {}).name || id; },

  /* ============ state ============ */
  async loadExistingMonster() {
    const savedId = localStorage.getItem('dm_monster_id');
    if (savedId) {
      try {
        const m = await Api.getMonster(savedId);
        if (m) {
          this.currentMonster = m;
          this.monsterId = savedId;
          return;
        }
      } catch (e) { }
    }
    try {
      const list = await Api.listMonsters();
      if (list.length > 0) {
        this.currentMonster = list[0];
        this.monsterId = list[0].id;
        localStorage.setItem('dm_monster_id', list[0].id);
      }
    } catch (e) { }
  },

  async pollState() {
    if (!this.monsterId) return;
    try {
      const m = await Api.getMonster(this.monsterId);
      if (!m) return;
      this.applyState(m, this.currentMonster);
      this.currentMonster = m;
    } catch (e) { }
  },

  /* 状態→ステージ/HUD反映。prevとの差分で演出を発火する */
  applyState(m, prev) {
    // 進化検知（生存時のみ・タマゴ孵化含む）
    if (prev && prev.species_id !== m.species_id && m.alive) {
      const isHatch = prev.stage === 'egg';
      Stage.playEvolution(m.species_id, m.monster_type, () => {
        const f = document.getElementById('flash');
        f.classList.add('on');
        setTimeout(() => f.classList.remove('on'), 380);
      }, null);
      this.toast(isHatch ? `${this.speciesName(m.species_id)}がうまれた！🎉`
        : `${this.speciesName(prev.species_id)}が ${this.speciesName(m.species_id)}に しんかした！🎉`, 3500);
      if (!isHatch) Achievements.notify('evolution', { stage: m.stage, careMisses: m.care_misses });
    } else if (!prev || !Stage.isBusy()) {
      Stage.setSpecies(m.species_id, m.monster_type);
    }

    Stage.setSleeping(m.sleeping);
    Stage.setNight(m.sleeping || !m.lights_on);
    Stage.setSick(m.alive && m.sick);
    Stage.setHungry(m.alive && m.hunger <= 1);
    Stage.setAlert(m.alive && m.care_call_active);
    if (!Stage.isBusy()) Stage.setPoops(m.poop_count);

    // 死亡検知
    if (prev && prev.alive && !m.alive) {
      Stage.playDeath();
      setTimeout(() => document.getElementById('death-overlay').classList.remove('hidden'), 1600);
    } else if (!prev && !m.alive) {
      Stage.playDeath();
      document.getElementById('death-overlay').classList.remove('hidden');
    }

    // うんち追加をポップで知らせる
    if (prev && m.poop_count > prev.poop_count && !Stage.isBusy()) {
      SFX.play('plop');
      this.toast('うんちをした…💩');
    }
    // 世話コール発生をチャイムで知らせる
    if (prev && !prev.care_call_active && m.care_call_active) {
      SFX.play('alert');
      this.toast('よんでいる！せわをしてあげて❗', 3000);
    }
    // 消灯/点灯の切替
    if (prev && prev.lights_on !== m.lights_on) SFX.play('night');

    this.markRaised(m.species_id);
    this.updateHUD(m, prev);
  },

  /* ============ ずかん / じまん ============ */
  zukanGet(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; }
  },
  markRaised(id) {
    const z = this.zukanGet('dm_zukan_raised');
    if (!z[id]) { z[id] = Date.now(); localStorage.setItem('dm_zukan_raised', JSON.stringify(z)); }
  },
  markMet(id) {
    const z = this.zukanGet('dm_zukan_met');
    if (!z[id]) { z[id] = Date.now(); localStorage.setItem('dm_zukan_met', JSON.stringify(z)); }
  },

  openZukan() {
    const raised = this.zukanGet('dm_zukan_raised');
    const met = this.zukanGet('dm_zukan_met');
    const grid = document.getElementById('zukan-grid');
    grid.innerHTML = '';
    let n = 0;
    for (const s of this.speciesList) {
      const r = !!raised[s.id], m = !!met[s.id];
      if (r) n++;
      const d = document.createElement('div');
      d.className = 'zcard ' + (r ? 'raised' : m ? 'met' : 'unseen');
      d.innerHTML = `<span class="zi">${this.ZUKAN_EMOJI[s.id] || '❓'}</span>`
        + `<span class="zn">${(r || m) ? s.name : '？？？'}</span>`
        + `<span class="zs">${this.STAGE_JP[s.stage] || s.stage}</span>`;
      grid.appendChild(d);
    }
    document.getElementById('zukan-count').textContent = `そだてた ${n}/${this.speciesList.length}`;
    Achievements.notify('zukan', { raised: n, total: this.speciesList.length });
    document.getElementById('zukan-overlay').classList.remove('hidden');
  },

  openAchievements() {
    const list = Achievements.list();
    const box = document.getElementById('achievements-list');
    box.innerHTML = '';
    let count = 0;
    for (const a of list) {
      if (a.unlocked) count++;
      const item = document.createElement('div');
      item.className = 'achievement-card ' + (a.unlocked ? 'unlocked' : 'locked');
      item.innerHTML = a.unlocked
        ? `<i>${a.emoji}</i><span><b>${a.name}</b><small>${a.description}<br>称号「${a.title}」</small></span>`
        : '<i>❔</i><span><b>？？？</b><small>まだ解除されていません</small></span>';
      box.appendChild(item);
    }
    document.getElementById('achievements-count').textContent = `${count}/${list.length}`;
    document.getElementById('achievements-overlay').classList.remove('hidden');
  },

  async share() {
    const m = this.currentMonster;
    const r = this.record();
    const title = Achievements.currentTitle();
    const titleText = title ? `称号「${title}」\n` : '';
    const text = (m && m.alive)
      ? `${titleText}うちの${m.name}（${this.speciesName(m.species_id)}・${this.STAGE_JP[m.stage] || m.stage}）、バトル${r.w}勝${r.l}敗！\nグリッチボーン ガーデンで育ててみて🥚\n${this.PUBLIC_URL}`
      : `タマゴから育てるふしぎな生きもの、グリッチボーン ガーデン🥚\n${this.PUBLIC_URL}`;
    // スマホだけ共有シート（デスクトップChromeにもnavigator.shareがあるがUXが悪いのでコピーに寄せる）
    const isTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    if (isTouch && navigator.share) {
      try { await navigator.share({ text }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(text);
      this.toast('じまん文をコピーした！SNSにはってね📣', 3000);
    } catch (e) {
      this.toast(this.PUBLIC_URL, 4000);
    }
  },

  updateHUD(m, prev) {
    document.getElementById('mon-name').textContent = m.name;
    document.getElementById('mon-stage').textContent = this.STAGE_JP[m.stage] || m.stage;
    document.getElementById('mon-species').textContent = `${this.speciesName(m.species_id)} — GLITCHBORN GARDEN`;
    const set = (id, val, warn, key) => {
      const el = document.getElementById(id);
      el.querySelector('b').textContent = val;
      el.classList.toggle('warn', !!warn);
      if (prev && prev[key] !== undefined && String(prev[key]) !== String(m[key])) {
        el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
        setTimeout(() => el.classList.remove('bump'), 250);
      }
    };
    set('stat-hunger', '♥'.repeat(m.hunger) + '♡'.repeat(4 - m.hunger), m.hunger === 0, 'hunger');
    set('stat-strength', '★'.repeat(m.strength) + '☆'.repeat(4 - m.strength), false, 'strength');
    set('stat-weight', m.weight + 'g', false, 'weight');
    set('stat-stamina', `${m.stamina}/${m.max_stamina}`, m.stamina === 0, 'stamina');
    set('stat-poop', m.poop_count, m.poop_count >= 4, 'poop_count');
    const bl = document.getElementById('btn-lights');
    bl.querySelector('i').textContent = m.lights_on ? '💡' : '🌙';
    bl.querySelector('span').textContent = m.lights_on ? 'でんき' : 'おこす';
    this.updateRecordChip();
  },

  record() {
    try { return JSON.parse(localStorage.getItem('dm_record_' + this.monsterId)) || { w: 0, l: 0 }; }
    catch (e) { return { w: 0, l: 0 }; }
  },
  saveRecord(rec) { localStorage.setItem('dm_record_' + this.monsterId, JSON.stringify(rec)); },
  updateRecordChip() {
    const r = this.record();
    document.querySelector('#stat-record b').textContent = `${r.w}勝${r.l}敗`;
    const streak = Achievements.streak();
    const el = document.getElementById('win-streak');
    el.textContent = `🔥x${streak}`;
    el.classList.toggle('hidden', streak < 2);
  },

  toast(msg, dur) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.add('hidden'), dur || 2200);
  },

  /* ============ actions ============ */
  async onAction(act) {
    if (!this.monsterId || this.actionLock) return;
    if (this.currentMonster && !this.currentMonster.alive) {
      document.getElementById('death-overlay').classList.remove('hidden');
      return;
    }
    if (act === 'train') { this.startTrainMini(); return; }
    if (act === 'battle') { document.getElementById('strategy-overlay').classList.remove('hidden'); return; }
    await this.doAction(act);
  },

  async doAction(act, payload) {
    this.actionLock = true;
    const before = this.currentMonster;
    try {
      const data = await Api.action(this.monsterId, act, payload);
      const ok = data.success !== false;
      if (data.state) { this.applyState(data.state, this.currentMonster); this.currentMonster = data.state; }
      if (ok) {
        if (act === 'feed') Stage.react('eat');
        else if (act === 'protein') Stage.react('protein');
        else if (act === 'train') Stage.react('train');
        else if (act === 'clean') Stage.react('clean');
        else if (act === 'medicine') Stage.react('medicine');
        if (act === 'feed') Achievements.notify('feed');
        if (['feed', 'protein', 'train', 'clean', 'medicine'].includes(act)) {
          Achievements.notify('care', { hour: new Date().getHours() });
        }
        if (act === 'clean') Achievements.notify('clean', { poopCount: before ? before.poop_count : 0 });
        if (act === 'train') Achievements.notify('train', { hits: payload && payload.hits });
      } else {
        Stage.react('refuse');
      }
      if (data.message) this.toast(data.message);
    } catch (e) {
      this.toast('通信エラー');
    }
    this.actionLock = false;
  },

  pet() {
    const m = this.currentMonster;
    if (!m || !m.alive || Stage.isBusy()) return;
    Stage.react('pet');
    const lines = m.sleeping ? ['すやすや…💤']
      : m.sick ? ['ぐったりしてる…くすりをあげて']
        : ['うれしそう！', 'きもちよさそう！', 'なついてきた！', 'ぷにぷにだ'];
    this.toast(lines[Math.floor(Math.random() * lines.length)], 1500);
  },

  /* ============ battle ============ */
  async doBattle(strategy) {
    this.actionLock = true;
    try {
      const r = await Api.battle(this.monsterId, strategy);
      if (!r.ok) {
        Stage.react('refuse');
        this.toast(r.detail || 'いまはバトルできない');
        this.actionLock = false;
        return;
      }
      const data = r.result;
      this.markMet(data.opponent_species);
      // バナー表示
      const banner = document.getElementById('battle-banner');
      const oppSp = this.speciesName(data.opponent_species);
      document.getElementById('battle-opp').textContent =
        data.opponent_name === oppSp ? oppSp : `${data.opponent_name}（${oppSp}）`;
      const labels = {
        aggressive: ['🔥', 'こうげき'], balanced: ['⚖️', 'バランス'], defensive: ['🛡️', 'まもり'],
      };
      const advantage = { aggressive: 'defensive', defensive: 'balanced', balanced: 'aggressive' };
      const ps = labels[data.player_strategy] || labels.balanced;
      const os = labels[data.opponent_strategy] || labels.balanced;
      const strategyWin = advantage[data.player_strategy] === data.opponent_strategy;
      const strategyLoss = advantage[data.opponent_strategy] === data.player_strategy;
      document.getElementById('battle-strategy').textContent =
        `${ps[0]}${ps[1]} vs ${os[0]}${os[1]} — ${strategyWin ? '作戦勝ち！' : strategyLoss ? '作戦負け…' : '互角！'}`;
      const pips = document.getElementById('battle-pips');
      pips.innerHTML = data.rounds.map(() => '⚪').join('');
      banner.classList.remove('hidden');

      Stage.playBattle(data, data.opponent_species, {
        round: (i, won) => {
          const chars = [...pips.textContent];
          if (i < chars.length) chars[i] = won ? '🔵' : '🔴';
          pips.textContent = chars.join('');
        },
        result: (won) => {
          const r = this.record();
          if (won) r.w++; else r.l++;
          this.saveRecord(r);
          Achievements.notify('battle', { won, strategy: data.player_strategy, strategyWin });
          this.updateRecordChip();
          this.toast(won ? '🏆 しょうり！' : '😢 まけた…', 2600);
        },
        done: async () => {
          banner.classList.add('hidden');
          await this.pollState();
          this.actionLock = false;
        },
      });
    } catch (e) {
      this.toast('通信エラー');
      this.actionLock = false;
    }
  },

  /* ============ train minigame ============ */
  train: { active: false, pos: 0, dir: 1, speed: 1.6, results: [], lock: false },

  startTrainMini() {
    const m = this.currentMonster;
    if (m && m.sleeping) { this.toast('ねているよ…'); return; }
    this.train = { active: true, pos: 0, dir: 1, speed: 1.6, results: [], lock: false };
    this.renderTrainPips();
    document.getElementById('train-overlay').classList.remove('hidden');
  },

  startTrainLoop() {
    let last = performance.now();
    const loop = (now) => {
      const dt = (now - last) / 1000; last = now;
      const tr = this.train;
      if (tr.active && !tr.lock) {
        tr.pos += tr.dir * tr.speed * dt;
        if (tr.pos > 1) { tr.pos = 1; tr.dir = -1; }
        if (tr.pos < 0) { tr.pos = 0; tr.dir = 1; }
        const bar = document.getElementById('train-bar');
        const cur = document.getElementById('train-cursor');
        cur.style.left = `calc(${(tr.pos * 100).toFixed(1)}% - ${(tr.pos * 8).toFixed(1)}px)`;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  renderTrainPips() {
    const spans = document.querySelectorAll('#train-pips span');
    spans.forEach((s, i) => {
      const r = this.train.results[i];
      s.textContent = r === undefined ? '○' : (r ? '◉' : '✕');
      s.className = r === undefined ? '' : (r ? 'hit' : 'miss');
    });
  },

  trainPress() {
    const tr = this.train;
    if (!tr.active || tr.lock) return;
    const hit = tr.pos >= 0.37 && tr.pos <= 0.63;  // #train-target と同じ範囲
    SFX.play(hit ? 'pop' : 'buzz');
    tr.results.push(hit);
    this.renderTrainPips();
    tr.lock = true;
    setTimeout(() => {
      tr.lock = false;
      tr.speed += 0.5;
      if (tr.results.length >= 3) this.finishTrainMini();
    }, 400);
  },

  async finishTrainMini() {
    const hits = this.train.results.filter(Boolean).length;
    this.train.active = false;
    document.getElementById('train-overlay').classList.add('hidden');
    await this.doAction('train', { hits });  // 成果に応じて筋力+0〜+2（メッセージはエンジンが返す）
  },

  /* ============ なかま切替 ============ */
  async openSwitcher() {
    let list = [];
    try { list = await Api.listMonsters(); } catch (e) { }
    const box = document.getElementById('switch-list');
    box.innerHTML = '';
    for (const m of list) {
      const b = document.createElement('button');
      b.className = (m.id === this.monsterId ? 'current ' : '') + (m.alive ? '' : 'dead');
      const rec = (() => { try { return JSON.parse(localStorage.getItem('dm_record_' + m.id)) || { w: 0, l: 0 }; } catch (e) { return { w: 0, l: 0 }; } })();
      b.innerHTML = `<span>${m.name}</span><span class="meta">${this.speciesName(m.species_id)}${m.alive ? '' : '・👻'}・🏆${rec.w}勝${rec.l}敗</span>`;
      b.addEventListener('click', () => this.switchTo(m));
      if (!m.alive) b.addEventListener('click', () => Achievements.notify('grave'));
      box.appendChild(b);
    }
    document.getElementById('switch-overlay').classList.remove('hidden');
  },

  switchTo(m) {
    SFX.play('pop');
    document.getElementById('switch-overlay').classList.add('hidden');
    if (m.id === this.monsterId) return;
    this.monsterId = m.id;
    localStorage.setItem('dm_monster_id', m.id);
    document.getElementById('death-overlay').classList.add('hidden');
    Stage.revive();          // ゴースト/夜をリセット
    Stage.setSpecies(m.species_id, m.monster_type);
    this.applyState(m, null);
    this.currentMonster = m;
    this.toast(`${m.name}に あいにきた！`);
    this.pollState();
  },

  /* ============ create / restart ============ */
  async createMonster() {
    const name = document.getElementById('monster-name').value.trim();
    if (!name) return;
    try {
      const data = await Api.createMonster(name);
      this.currentMonster = data;
      this.monsterId = data.id;
      localStorage.setItem('dm_monster_id', data.id);
      document.getElementById('create-dialog').classList.add('hidden');
      this.applyState(data, null);
      SFX.play('born');
      this.toast(`${name}のタマゴだ！だいじにそだてよう🥚`, 3000);
    } catch (e) {
      this.toast('エラーが発生しました');
    }
  },

  async restartFromEgg() {
    if (!this.currentMonster) return;
    const oldId = this.monsterId;
    const name = this.currentMonster.name || 'グリボン';
    try {
      if (oldId) await Api.deleteMonster(oldId);
      const data = await Api.createMonster(name);
      this.monsterId = data.id;
      localStorage.setItem('dm_monster_id', data.id);
      document.getElementById('death-overlay').classList.add('hidden');
      Stage.revive();
      this.applyState(data, null);
      this.currentMonster = data;
      SFX.play('born');
      this.toast('あたらしいタマゴがやってきた🥚', 3000);
    } catch (e) {
      this.toast('やり直しに失敗しました');
    }
  },
};

window.addEventListener('DOMContentLoaded', () => Game.init());
