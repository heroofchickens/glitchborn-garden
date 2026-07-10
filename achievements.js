/** クライアント専用の実績・称号・連勝管理。 */
const Achievements = (() => {
  'use strict';

  const KEY = 'glitchborn-achievements';
  const DEFINITIONS = [
    { id: 'first_feed', name: 'はじめてのごはん', emoji: '🍖', description: 'ごはんをはじめてあげる', title: 'かけだし飼育員' },
    { id: 'first_win', name: 'はじめての勝利', emoji: '🏆', description: 'バトルではじめて勝つ', title: 'ルーキーファイター' },
    { id: 'streak_3', name: '波に乗ってる！', emoji: '🔥', description: 'バトルで3連勝する', title: '連勝ファイター' },
    { id: 'streak_10', name: '無敵の進撃', emoji: '🌋', description: 'バトルで10連勝する', title: '無敗の伝説' },
    { id: 'flawless_adult', name: 'パーフェクト育成', emoji: '✨', description: '育成ミス0でアダルトに進化する', title: '完璧な育て親' },
    { id: 'perfect_stage', name: '究極への到達', emoji: '👑', description: 'パーフェクトまで育てる', title: '進化の証人' },
    { id: 'zukan_complete', name: 'ずかんコンプリート', emoji: '📖', description: '全種族を育てて登録する', title: 'グリッチボーン博士' },
    { id: 'first_grave', name: 'また会う日まで', emoji: '🪦', description: 'はじめてお墓参りをする', title: '思い出の守り人' },
    { id: 'evolution_3', name: '進化ウォッチャー', emoji: '🦋', description: '進化を3回見届ける', title: '進化観測員' },
    { id: 'strategy_win', name: '作戦どおり！', emoji: '🧠', description: '作戦勝ちしたバトルに勝つ', title: '駆け引き上手' },
    { id: 'all_strategies', name: '三策の達人', emoji: '🎯', description: '全作戦でバトルに勝つ', title: '戦術マスター' },
    { id: 'midnight_care', name: '夜ふかし当番', emoji: '🌙', description: '0〜4時にお世話をする', title: '深夜の見守り人' },
    { id: 'full_cleanup', name: 'ギリギリ大そうじ', emoji: '🧹', description: 'うんち満杯をそうじする', title: 'ピカピカ職人' },
    { id: 'perfect_train', name: 'トレーニング名人', emoji: '💪', description: 'トレーニングでパーフェクトを出す', title: '筋トレコーチ' },
    { id: 'battle_20', name: '百戦錬磨への道', emoji: '⚔️', description: 'バトルを20回たたかう', title: '歴戦のテイマー' },
  ];

  function blank() { return { unlocked: {}, stats: { streak: 0, battles: 0, evolutions: 0, winningStrategies: [] } }; }
  function load() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY));
      if (!value || typeof value !== 'object') return blank();
      value.unlocked = value.unlocked || {};
      value.stats = Object.assign(blank().stats, value.stats || {});
      return value;
    } catch (e) { return blank(); }
  }
  function save(state) { localStorage.setItem(KEY, JSON.stringify(state)); }
  function unlock(state, id) {
    if (state.unlocked[id]) return null;
    const def = DEFINITIONS.find(d => d.id === id);
    if (!def) return null;
    state.unlocked[id] = Date.now();
    return def;
  }

  function notify(eventName, payload) {
    payload = payload || {};
    const state = load();
    const gained = [];
    const earn = id => { const d = unlock(state, id); if (d) gained.push(d); };

    if (eventName === 'feed') earn('first_feed');
    if (eventName === 'battle') {
      state.stats.battles++;
      if (payload.won) {
        state.stats.streak++;
        earn('first_win');
        if (state.stats.streak >= 3) earn('streak_3');
        if (state.stats.streak >= 10) earn('streak_10');
        if (payload.strategy && !state.stats.winningStrategies.includes(payload.strategy)) {
          state.stats.winningStrategies.push(payload.strategy);
        }
        if (payload.strategyWin) earn('strategy_win');
        if (state.stats.winningStrategies.length >= 3) earn('all_strategies');
      } else {
        state.stats.streak = 0;
      }
      if (state.stats.battles >= 20) earn('battle_20');
    }
    if (eventName === 'evolution') {
      state.stats.evolutions++;
      if (state.stats.evolutions >= 3) earn('evolution_3');
      if (payload.stage === 'adult' && payload.careMisses === 0) earn('flawless_adult');
      if (payload.stage === 'perfect') earn('perfect_stage');
    }
    if (eventName === 'zukan' && payload.raised >= payload.total && payload.total > 0) earn('zukan_complete');
    if (eventName === 'grave') earn('first_grave');
    if (eventName === 'care' && payload.hour >= 0 && payload.hour < 5) earn('midnight_care');
    if (eventName === 'clean' && payload.poopCount >= 8) earn('full_cleanup');
    if (eventName === 'train' && payload.hits >= 3) earn('perfect_train');

    save(state);
    if (gained.length && typeof onUnlock === 'function') gained.forEach(onUnlock);
    return gained;
  }

  let onUnlock = null;
  function setUnlockHandler(fn) { onUnlock = fn; }
  function currentTitle() {
    const unlocked = load().unlocked;
    for (let i = DEFINITIONS.length - 1; i >= 0; i--) {
      if (unlocked[DEFINITIONS[i].id]) return DEFINITIONS[i].title;
    }
    return '';
  }
  function streak() { return load().stats.streak || 0; }
  function list() {
    const state = load();
    return DEFINITIONS.map(d => Object.assign({}, d, { unlocked: !!state.unlocked[d.id] }));
  }

  return { DEFINITIONS, notify, setUnlockHandler, currentTitle, streak, list, _internals: { load, unlock, blank } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Achievements;
