/**
 * Stage3D: 十様式プロシージャルキャラの箱庭ステージ
 * 種族系統ごとにスタイルを割当:
 *   デジタマ=風船風エッグ(mesh) / スライム=SDFスライム / Blaze系=トゥーンSDF二足
 *   Shadow系=墨絵キツネ / Gale系=折り紙ヅル / ヌメモン=粘土(12fpsコマ撮り) / ダークウォリアー=切り絵
 * game.js からは Stage.* の公開APIだけを叩く。
 */
const Stage = (() => {
  'use strict';

  /* ============ helpers ============ */
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function qstep(x, n) { return Math.floor(x * n) / n; }
  function spring(o, target, k, c, dt) { o.v += (-k * (o.x - target) - c * o.v) * dt; o.x += o.v * dt; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function len(a) { return Math.hypot(a[0], a[1], a[2]); }
  function norm(a) { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function dotv(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  /* 2-bone IK */
  function ik2(H, F, l1, l2, bendDir) {
    let d = sub(F, H), dl = len(d);
    dl = clamp(dl, Math.abs(l1 - l2) + 0.02, l1 + l2 - 0.01);
    const dn = norm(d);
    const a = clamp((l1 * l1 - l2 * l2 + dl * dl) / (2 * dl), -l1, l1);
    const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
    let bp = sub(bendDir, mul(dn, dotv(bendDir, dn)));
    if (len(bp) < 1e-4) bp = [0, 1, 0];
    bp = norm(bp);
    return add(add(H, mul(dn, a)), mul(bp, h));
  }

  const MATS = [];  // uTime更新が必要なマテリアル
  function dropMat(m) { const i = MATS.indexOf(m); if (i >= 0) MATS.splice(i, 1); m.dispose(); }
  function sfx(name) { if (window.SFX) window.SFX.play(name); }

  /* ============ トゥーンシェーダ ============ */
  const VSH = [
    'varying vec3 vN; varying vec3 vWP; varying vec3 vOP;',
    'void main(){',
    '  vOP=position;',
    '  vec4 wp=modelMatrix*vec4(position,1.0);',
    '  vWP=wp.xyz;',
    '  vN=normalize(mat3(modelMatrix)*normal);',
    '  gl_Position=projectionMatrix*viewMatrix*wp;',
    '}'
  ].join('\n');

  const NOISE = [
    'float hash3(vec3 p){ p=fract(p*0.3183099+vec3(0.1,0.2,0.3)); p*=17.0;',
    '  return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }',
    'float vnoise(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);',
    '  return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),',
    '                 mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),',
    '             mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),',
    '                 mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z); }'
  ].join('\n');

  const FSH = [
    'uniform vec3 uColor; uniform vec3 uAccent; uniform float uTime; uniform float uInk; uniform float uDay;',
    'varying vec3 vN; varying vec3 vWP; varying vec3 vOP;',
    NOISE,
    'void main(){',
    '  vec3 N=normalize(vN);',
    '  vec3 V=normalize(cameraPosition-vWP);',
    '  vec3 L=normalize(vec3(0.5,0.8,0.45));',
    '  vec3 base=uColor;',
    '  #ifdef PAPER',
    '  if(!gl_FrontFacing){ base=uAccent; N=-N; }',
    '  #endif',
    '  float dif=dot(N,L);',
    '  float lit=smoothstep(-0.05,0.05,dif)*0.55+smoothstep(0.24,0.34,dif)*0.45;',
    '  vec3 col=mix(base*vec3(0.55,0.56,0.74),base,lit);',
    '  #ifdef INK',
    '  float qt=floor(uTime*8.0)/8.0;',
    '  vec3 nn=normalize(N+(vec3(vnoise(vOP*5.0+qt),vnoise(vOP*5.0+9.7+qt),vnoise(vOP*5.0+4.3+qt))-0.5)*0.6);',
    '  float rim=1.0-max(dot(nn,V),0.0);',
    '  float edge=smoothstep(0.45,0.75,rim+(vnoise(vOP*7.0+qt)-0.5)*0.28+uInk*0.4);',
    '  float wash=smoothstep(0.25,-0.7,nn.y)*0.22;',
    '  vec3 ink=vec3(0.10,0.095,0.09);',
    '  col=mix(uColor,ink,clamp(edge+wash,0.0,1.0));',
    '  col=mix(col,ink,smoothstep(0.72,0.95,vnoise(vOP*16.0+qt*0.5))*edge*0.65);',
    '  #endif',
    '  #ifdef FLAT2D',
    '  col=uColor;',
    '  #endif',
    '  col*=mix(vec3(0.45,0.5,0.8),vec3(1.0),uDay);',
    '  gl_FragColor=vec4(col,1.0);',
    '}'
  ].join('\n');

  const OUT_VSH = [
    'uniform float uTime; uniform float uW;',
    NOISE,
    'void main(){',
    '  float qt=floor(uTime*8.0)/8.0;',
    '  float d=uW*(1.0+0.8*(vnoise(position*4.0+qt)-0.5));',
    '  vec3 p=position+normal*d;',
    '  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);',
    '}'
  ].join('\n');
  const OUT_FSH = 'uniform vec3 uColor; void main(){ gl_FragColor=vec4(uColor,1.0); }';

  let DAY = { value: 1.0 };  // 昼夜（全マテリアル共有）

  function toonMat(color, opts) {
    opts = opts || {};
    const defines = {};
    if (opts.mode) defines[opts.mode] = 1;
    const m = new THREE.ShaderMaterial({
      defines, vertexShader: VSH, fragmentShader: FSH,
      side: opts.side || THREE.FrontSide,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uAccent: { value: new THREE.Color(opts.accent || 0xffffff) },
        uTime: { value: 0 },
        uInk: { value: opts.ink || 0 },
        uDay: DAY,
      }
    });
    MATS.push(m);
    return m;
  }
  function outlineMat(width) {
    const m = new THREE.ShaderMaterial({
      vertexShader: OUT_VSH, fragmentShader: OUT_FSH, side: THREE.BackSide,
      uniforms: { uColor: { value: new THREE.Color(0x1a1815) }, uTime: { value: 0 }, uW: { value: width } }
    });
    MATS.push(m);
    return m;
  }

  /* ============ SDFレイマーチシェーダ（Blaze系/粘土/スライム） ============ */
  const RMV = 'varying vec3 vWP; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vWP=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }';
  const RMF = [
    'uniform vec4 uQA[14]; uniform vec4 uQB[14]; uniform vec4 uQC[14];',
    'uniform int uQn; uniform vec4 uBnd; uniform vec4 uQE[4]; uniform float uTime; uniform float uDay;',
    'varying vec3 vWP;',
    NOISE,
    'float dot2q(vec3 v){return dot(v,v);}',
    'float sdRC(vec3 p, vec3 a, vec3 b, float r1, float r2){',
    '  vec3 ba=b-a; float l2=dot(ba,ba); float rr=r1-r2;',
    '  float a2=l2-rr*rr; float il2=1.0/max(l2,1e-6);',
    '  vec3 pa=p-a; float y=dot(pa,ba); float z=y-l2;',
    '  float x2=dot2q(pa*l2-ba*y); float y2=y*y*l2; float z2=z*z*l2;',
    '  float k=sign(rr)*rr*rr*x2;',
    '  if(sign(z)*a2*z2>k) return sqrt(x2+z2)*il2-r2;',
    '  if(sign(y)*a2*y2<k) return sqrt(x2+y2)*il2-r1;',
    '  return (sqrt(x2*a2*il2)+y*rr)*il2-r1;',
    '}',
    'float sminQ(float a,float b,float k){ float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0); return mix(b,a,h)-k*h*(1.0-h);}',
    'float mapQ(vec3 p){ float d=1e5;',
    '  for(int i=0;i<14;i++){ if(i>=uQn) break;',
    '    d=sminQ(d,sdRC(p,uQA[i].xyz,uQB[i].xyz,uQA[i].w,uQB[i].w),uQC[i].w); }',
    '  return d; }',
    'float eyeQd(vec3 p){ float d=1e5;',
    '  for(int i=0;i<4;i++){ if(uQE[i].w>0.0001) d=min(d,length(p-uQE[i].xyz)-uQE[i].w); }',
    '  return d; }',
    'float mapAll(vec3 p){ return min(mapQ(p),eyeQd(p)); }',
    'vec3 colQ(vec3 p){ float d=1e5; vec3 c=vec3(1.0);',
    '  for(int i=0;i<14;i++){ if(i>=uQn) break;',
    '    float di=sdRC(p,uQA[i].xyz,uQB[i].xyz,uQA[i].w,uQB[i].w);',
    '    float k=uQC[i].w; float h=clamp(0.5+0.5*(d-di)/k,0.0,1.0);',
    '    c=mix(c,uQC[i].rgb,h); d=mix(d,di,h)-k*h*(1.0-h); }',
    '  return c; }',
    'vec3 nQ(vec3 p){ vec2 e=vec2(1.0,-1.0)*0.0018;',
    '  return normalize(e.xyy*mapAll(p+e.xyy)+e.yyx*mapAll(p+e.yyx)+e.yxy*mapAll(p+e.yxy)+e.xxx*mapAll(p+e.xxx)); }',
    'void main(){',
    '  vec3 ro=cameraPosition; vec3 rd=normalize(vWP-ro);',
    '  vec3 oc=ro-uBnd.xyz; float b=dot(oc,rd); float c=dot(oc,oc)-uBnd.w*uBnd.w;',
    '  float hh=b*b-c; if(hh<0.0) discard;',
    '  hh=sqrt(hh); float t=max(-b-hh,0.0); float t1=-b+hh;',
    '  float d=0.0; bool hit=false; vec3 p=ro;',
    '  for(int i=0;i<64;i++){',
    '    p=ro+rd*t; d=mapAll(p);',
    '    if(d<0.0012*t+0.001){ hit=true; break; }',
    '    t+=d*0.95;',
    '    if(t>t1) break;',
    '  }',
    '  if(!hit) discard;',
    '  vec3 N=nQ(p);',
    '  vec3 V=-rd;',
    '  vec3 L=normalize(vec3(0.5,0.8,0.45));',
    '  float de=eyeQd(p); float dc2=mapQ(p);',
    '  bool isEye=(de<dc2);',
    '  vec3 alb;',
    '  if(isEye){',
    '    float dw=min(length(p-uQE[0].xyz)-uQE[0].w,length(p-uQE[1].xyz)-uQE[1].w);',
    '    float dk=min(length(p-uQE[2].xyz)-uQE[2].w,length(p-uQE[3].xyz)-uQE[3].w);',
    '    alb=(dk<dw)?vec3(0.12,0.12,0.17):vec3(0.99,0.99,1.0);',
    '  } else alb=colQ(p);',
    '  float dif=dot(N,L);',
    '  vec3 col;',
    '#if STYLE==1',
    '  vec3 N2=normalize(N+(vec3(vnoise(p*7.0),vnoise(p*7.0+3.1),vnoise(p*7.0+6.2))-0.5)*0.5);',
    '  if(!isEye){',
    '    alb*=0.93+0.12*vnoise(p*13.0);',
    '    alb*=1.0-0.05*smoothstep(0.35,0.65,fract(vnoise(p*2.2)*7.0));',
    '  }',
    '  dif=dot(N2,L);',
    '  float lit1=smoothstep(-0.05,0.08,dif)*0.6+smoothstep(0.3,0.42,dif)*0.4;',
    '  col=mix(alb*vec3(0.5,0.45,0.5),alb,lit1);',
    '  float ol1=smoothstep(0.28,0.12,dot(N2,V));',
    '  col=mix(col,col*0.35,ol1*0.8);',
    '#elif STYLE==2',
    '  float fres=pow(1.0-max(dot(N,V),0.0),2.4);',
    '  vec3 deep=alb*vec3(0.25,0.5,0.35);',
    '  float lit2=0.45+0.55*smoothstep(0.0,0.4,dif);',
    '  col=mix(deep,alb,lit2*0.7);',
    '  col+=pow(max(dot(N,V),0.0),3.0)*alb*0.35;',
    '  col+=fres*vec3(0.65,1.0,0.75)*0.55;',
    '  float sp2=pow(max(dot(reflect(-L,N),V),0.0),60.0);',
    '  col+=vec3(1.0)*smoothstep(0.3,0.5,sp2)*0.8;',
    '  if(isEye) col=alb;',
    '#else',
    '  float lit0=smoothstep(-0.02,0.06,dif)*0.55+smoothstep(0.26,0.34,dif)*0.45;',
    '  col=mix(alb*vec3(0.52,0.55,0.82),alb,lit0);',
    '  if(!isEye){',
    '    float sp0=pow(max(dot(reflect(-L,N),V),0.0),26.0);',
    '    col+=vec3(1.0)*smoothstep(0.48,0.56,sp0)*0.3;',
    '    float rim0=pow(1.0-max(dot(N,V),0.0),3.0);',
    '    col+=vec3(0.55,0.75,1.0)*rim0*0.3;',
    '    float ol0=smoothstep(0.3,0.15,dot(N,V));',
    '    col=mix(col,col*0.24,ol0*0.85);',
    '  } else {',
    '    float gl2=pow(max(dot(reflect(-L,N),V),0.0),40.0);',
    '    col+=vec3(1.0)*smoothstep(0.4,0.6,gl2)*0.9;',
    '  }',
    '#endif',
    '  col*=mix(vec3(0.45,0.5,0.85),vec3(1.0),uDay);',
    '  gl_FragColor=vec4(col,1.0);',
    '}'
  ].join('\n');

  function v4s(n) { const a = []; for (let i = 0; i < n; i++) a.push(new THREE.Vector4(0, -50, 0, 0.001)); return a; }

  /* ============ scene ============ */
  let renderer, scene, camera, canvas;
  let T = 0;

  const cam = {
    az: 0, el: 0.26, dist: 4.6, tgt: new THREE.Vector3(0, 0.85, 0),
    wantDist: 4.6, dragAz: 0, dragEl: 0, shake: 0,
  };

  /* ---- 汎用スケジューラ ---- */
  const timers = [];
  function after(d, fn) { timers.push({ t: T + d, fn }); }
  const tweens = [];
  function tween(dur, apply, done) { tweens.push({ t0: T, dur, apply, done }); }
  function easeOut(u) { return 1 - (1 - u) * (1 - u); }
  function easeInOut(u) { return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u); }

  /* ---- blob shadow ---- */
  let shadowProto;
  function makeShadow(r) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), shadowProto.clone());
    m.rotation.x = -Math.PI / 2; m.position.y = 0.015;
    return m;
  }

  /* ---- emoji sprites（パーティクル & エモート）---- */
  const emojiTexCache = {};
  function emojiTex(ch) {
    if (emojiTexCache[ch]) return emojiTexCache[ch];
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.font = '48px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(ch, 32, 36);
    const t = new THREE.CanvasTexture(c);
    emojiTexCache[ch] = t;
    return t;
  }
  const glowTexCache = {};
  function glowTex(color) {
    if (glowTexCache[color]) return glowTexCache[color];
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 8, 64, 64, 64);
    gr.addColorStop(0, color);
    gr.addColorStop(0.5, color + 'aa');
    gr.addColorStop(1, color + '00');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    glowTexCache[color] = t;
    return t;
  }
  const particles = [];
  function burst(pos, ch, n, opts) {
    opts = opts || {};
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTex(ch), transparent: true, depthWrite: false }));
      const sc = (opts.size || 0.22) * (0.7 + Math.random() * 0.6);
      s.scale.set(sc, sc, 1);
      s.position.set(pos[0], pos[1], pos[2]);
      const a = Math.random() * Math.PI * 2, sp = (opts.speed || 1.4) * (0.5 + Math.random());
      s.userData = {
        vx: Math.cos(a) * sp * 0.6 + (opts.vx || 0),
        vy: (opts.vy != null ? opts.vy : 1.6) * (0.6 + Math.random() * 0.7),
        vz: Math.sin(a) * sp * 0.35,
        g: opts.g != null ? opts.g : -2.2,
        life: opts.life || 1.1, age: 0,
      };
      scene.add(s); particles.push(s);
    }
  }
  function updParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i], u = p.userData;
      u.age += dt;
      if (u.age > u.life) { scene.remove(p); p.material.dispose(); particles.splice(i, 1); continue; }
      u.vy += u.g * dt;
      p.position.x += u.vx * dt; p.position.y += u.vy * dt; p.position.z += u.vz * dt;
      if (p.position.y < 0.05 && u.vy < 0) { p.position.y = 0.05; u.vy *= -0.4; }
      p.material.opacity = clamp(1.4 - u.age / u.life * 1.5, 0, 1);
    }
  }

  /* ---- 常駐エモート（！/Zzz/病気）---- */
  function makeEmote(ch, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTex(ch), transparent: true, depthWrite: false }));
    s.scale.set(size, size, 1); s.visible = false;
    scene.add(s);
    return s;
  }
  let emoteAlert, emoteSick;
  let zzzTimer = 0;
  let hungryTimer = 2;

  /* ============ キャラビルダー ============ */
  /* 共通インターフェース: {update(t,dt,S), place(x,y,ang,sy), height, dispose(), setVisible(v)} */

  /* ---- SDF(RM)キャラ基盤 ---- */
  function makeRM(style, shR, scl) {
    const mt = new THREE.ShaderMaterial({
      defines: { STYLE: style }, transparent: true, depthWrite: false,
      vertexShader: RMV, fragmentShader: RMF,
      uniforms: {
        uQA: { value: v4s(14) }, uQB: { value: v4s(14) }, uQC: { value: v4s(14) },
        uQn: { value: 0 }, uBnd: { value: new THREE.Vector4(0, 1, 0, 1.5) }, uQE: { value: v4s(4) }, uTime: { value: 0 },
        uDay: DAY,
      }
    });
    MATS.push(mt);
    const o = {
      mat: mt, prims: [], scl: scl || 1,
      x: 0, y: 0, ang: 0, sy: 1,
      blinkNext: 2 + Math.random() * 2, blinkT: -9,
    };
    o.bill = new THREE.Mesh(new THREE.PlaneGeometry(3.4 * o.scl + 0.8, 3.4 * o.scl + 0.8), mt);
    o.bill.renderOrder = 3;
    scene.add(o.bill);
    o.shadow = makeShadow((shR || 0.5) * o.scl);
    scene.add(o.shadow);
    return o;
  }
  function rmP(o, a, b, ra, rb, col, k) { o.prims.push([a, b, ra, rb, col, k]); }
  function rmWP(o, p) {
    const c = Math.cos(o.ang), s = Math.sin(o.ang), q = o.scl;
    return [p[0] * q * c + p[2] * q * s + o.x, p[1] * q * o.sy + o.y, -p[0] * q * s + p[2] * q * c];
  }
  function rmUpload(o) {
    const n = Math.min(o.prims.length, 14);
    const bmin = [1e5, 1e5, 1e5], bmax = [-1e5, -1e5, -1e5];
    let rmax = 0;
    for (let i = 0; i < 14; i++) {
      if (i < n) {
        const pr = o.prims[i];
        const a = rmWP(o, pr[0]), b = rmWP(o, pr[1]);
        o.mat.uniforms.uQA.value[i].set(a[0], a[1], a[2], pr[2] * o.scl);
        o.mat.uniforms.uQB.value[i].set(b[0], b[1], b[2], pr[3] * o.scl);
        o.mat.uniforms.uQC.value[i].set(pr[4][0], pr[4][1], pr[4][2], pr[5] * o.scl);
        rmax = Math.max(rmax, pr[2] * o.scl, pr[3] * o.scl);
        for (let ax = 0; ax < 3; ax++) {
          bmin[ax] = Math.min(bmin[ax], a[ax], b[ax]);
          bmax[ax] = Math.max(bmax[ax], a[ax], b[ax]);
        }
      } else {
        o.mat.uniforms.uQA.value[i].set(0, -50, 0, 0.001);
        o.mat.uniforms.uQB.value[i].set(0, -50.01, 0, 0.001);
        o.mat.uniforms.uQC.value[i].set(0, 0, 0, 0.001);
      }
    }
    o.mat.uniforms.uQn.value = n;
    const bc = [(bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2, (bmin[2] + bmax[2]) / 2];
    const dx = bmax[0] - bc[0], dy = bmax[1] - bc[1], dz = bmax[2] - bc[2];
    o.mat.uniforms.uBnd.value.set(bc[0], bc[1], bc[2], Math.sqrt(dx * dx + dy * dy + dz * dz) + rmax + 0.15);
    o.prims.length = 0;
    o.bill.position.set(o.x, Math.max(1.2 * o.scl, 0.9) + o.y * 0.5, 0);
    o.shadow.position.x = o.x;
    const sh = clamp(1 - o.y * 0.5, 0.3, 1);
    o.shadow.scale.set(sh, sh, 1);
  }
  function rmEyes(o, t, eL, eR, r, dark) {
    if (t > o.blinkNext) { o.blinkT = t; o.blinkNext = t + 1.8 + Math.random() * 2.6; }
    const ba = t - o.blinkT, blink = (ba < 0.14) ? Math.sin(Math.PI * ba / 0.14) : 0;
    const er = r * o.scl * (1 - blink * 0.94);
    const wL = rmWP(o, eL), wR = rmWP(o, eR);
    const fw = [Math.sin(o.ang), 0, Math.cos(o.ang)];
    const U2 = o.mat.uniforms.uQE.value;
    if (dark) {
      U2[0].set(0, -50, 0, 0); U2[1].set(0, -50, 0, 0);
      U2[2].set(wL[0], wL[1], wL[2], er); U2[3].set(wR[0], wR[1], wR[2], er);
      return;
    }
    function pup(e) {
      const tc = [camera.position.x - e[0], camera.position.y - e[1], camera.position.z - e[2]];
      const l = Math.hypot(tc[0], tc[1], tc[2]) || 1;
      const d0 = fw[0] * 0.8 + tc[0] / l * 0.45, d1 = fw[1] * 0.8 + tc[1] / l * 0.45, d2 = fw[2] * 0.8 + tc[2] / l * 0.45;
      const l2 = Math.hypot(d0, d1, d2) || 1;
      return [e[0] + d0 / l2 * er * 0.62, e[1] + d1 / l2 * er * 0.62, e[2] + d2 / l2 * er * 0.62];
    }
    const pL = pup(wL), pR = pup(wR), prr = er * 0.5;
    U2[0].set(wL[0], wL[1], wL[2], er); U2[1].set(wR[0], wR[1], wR[2], er);
    U2[2].set(pL[0], pL[1], pL[2], prr); U2[3].set(pR[0], pR[1], pR[2], prr);
  }
  function rmDispose(o) {
    scene.remove(o.bill); scene.remove(o.shadow);
    o.bill.geometry.dispose(); o.shadow.geometry.dispose(); o.shadow.material.dispose();
    dropMat(o.mat);
  }
  function rmBase(o, height) {
    return {
      kind: 'rm', o, height: height * o.scl,
      place(x, y, ang, sy) { o.x = x; o.y = y; o.ang = ang; o.sy = sy; },
      setVisible(v) { o.bill.visible = v; o.shadow.visible = v; },
      dispose() { rmDispose(o); },
    };
  }

  /* ---- Blaze系: トゥーン二足（コロ型・パラメータ違い）---- */
  function makeKolo(p) {
    const o = makeRM(0, 0.5, p.scale);
    const ch = rmBase(o, 1.45);
    ch.update = (t, dt, S) => {
      const sp = S.speedMul;
      const ph = t * sp * (S.moving ? 6.4 : 3.0);
      const hipY = 0.60 + 0.035 * Math.cos(2 * ph);
      const CB = p.body, CL = p.limb, CB2 = p.foot, CC = p.belly, CE = p.ear;
      for (let i = 0; i < 2; i++) {
        const s = (i === 0) ? -1 : 1;
        const phF = ph + (s < 0 ? 0 : Math.PI), sn = Math.sin(phF);
        const lift = S.moving ? 0.17 : 0.04;
        const stride = S.moving ? 0.30 : 0.06;
        const ankle = [s * 0.15, Math.max(0, sn) * lift + 0.075, Math.cos(phF) * stride];
        const hip = [s * 0.12, hipY, 0];
        const knee = ik2(hip, ankle, 0.30, 0.30, [s * 0.2, 0.12, 1]);
        rmP(o, hip, knee, 0.105, 0.085, CL, 0.10);
        rmP(o, knee, ankle, 0.08, 0.07, CL, 0.08);
        rmP(o, ankle, add(ankle, [0, -0.005, 0.13]), 0.085, 0.098, CB2, 0.07);
        const sw = (S.moving ? 0.75 : 0.35) * Math.sin(ph + (s < 0 ? Math.PI : 0));
        const sh2 = [s * 0.30, hipY + 0.33, 0.02];
        rmP(o, sh2, add(sh2, [s * 0.12, -0.28 * Math.cos(sw * 0.5) - 0.02, 0.30 * Math.sin(sw)]), 0.083, 0.094, CL, 0.08);
      }
      rmP(o, [0, hipY - 0.02, 0], [0, hipY + 0.40, 0.045], 0.30, 0.235, CB, 0.14);
      rmP(o, [0, hipY + 0.04, 0.15], [0, hipY + 0.24, 0.155], 0.15, 0.12, CC, 0.20);
      const hc = [0, hipY + 0.66 + 0.02 * Math.cos(2 * ph + 0.6), 0.065];
      rmP(o, hc, add(hc, [0, 0.05, 0]), 0.27, 0.25, CB, 0.15);
      if (p.horn) {
        // ツノ（ウォリアー/ロード）
        rmP(o, add(hc, [0, 0.22, 0.05]), add(hc, [0, 0.44, 0.12]), 0.07, 0.015, p.hornCol, 0.08);
      }
      for (let j = 0; j < 2; j++) {
        const s2 = (j === 0) ? -1 : 1;
        const eb = add(hc, [s2 * 0.14, 0.20, 0]);
        rmP(o, eb, add(eb, [s2 * 0.11, p.earUp, -0.03]), 0.075, 0.028, CE, 0.10);
      }
      rmEyes(o, t, add(hc, [-0.115, 0.06, 0.235]), add(hc, [0.115, 0.06, 0.235]), 0.066, false);
      rmUpload(o);
    };
    return ch;
  }

  /* ---- ヌメモン: 粘土（12fpsコマ撮り）---- */
  function makeClay(p) {
    const o = makeRM(1, 0.6, p.scale);
    const ch = rmBase(o, 1.35);
    ch.update = (t, dt, S) => {
      const tq = Math.floor(t * 12) / 12;
      const ph = tq * S.speedMul * (S.moving ? 3.2 : 1.6);
      const CB = p.body, CD = p.limb, CC = p.belly;
      const hipY = 0.62 - Math.abs(Math.cos(ph)) * 0.04;
      for (let i = 0; i < 2; i++) {
        const s = (i === 0) ? -1 : 1;
        const phF = ph + (s < 0 ? 0 : Math.PI), sn = Math.sin(phF);
        const foot = [s * 0.20, Math.max(0, sn) * (S.moving ? 0.14 : 0.03) + 0.09, Math.cos(phF) * (S.moving ? 0.24 : 0.05)];
        const hip = [s * 0.15, hipY, 0];
        const knee = ik2(hip, foot, 0.30, 0.28, [s * 0.3, 0.1, 1]);
        rmP(o, hip, knee, 0.13, 0.11, CD, 0.10);
        rmP(o, knee, foot, 0.11, 0.13, CD, 0.09);
        const sw = 0.5 * Math.sin(phF + Math.PI);
        const sh3 = [s * 0.33, hipY + 0.38, 0];
        rmP(o, sh3, add(sh3, [s * 0.06, -0.32, 0.24 * sw]), 0.12, 0.14, CD, 0.11);
      }
      rmP(o, [0, hipY - 0.02, 0], [0, hipY + 0.42, 0.02], 0.34, 0.27, CB, 0.15);
      rmP(o, [0, hipY + 0.05, 0.18], [0, hipY + 0.26, 0.17], 0.16, 0.13, CC, 0.22);
      const hc = [0, hipY + 0.60, 0.05];
      rmP(o, hc, add(hc, [0, 0.10, 0]), 0.24, 0.20, CB, 0.18);
      rmP(o, add(hc, [0, 0.26, -0.02]), add(hc, [0, 0.33, -0.05]), 0.09, 0.05, CD, 0.12);
      rmEyes(o, tq, add(hc, [-0.10, 0.06, 0.20]), add(hc, [0.10, 0.06, 0.20]), 0.05, true);
      rmUpload(o);
    };
    return ch;
  }

  /* ---- スライム（smin変調+滴の分裂/吸収）---- */
  function makeSlime(p) {
    const o = makeRM(2, 0.62, p.scale);
    const eye = { L: { x: 0.13, v: 0 }, R: { x: 0.13, v: 0 } };
    const ch = rmBase(o, 0.85);
    ch.update = (t, dt, S) => {
      const ph = t * S.speedMul * 2.2;
      const CB = p.body, CD = p.dark;
      const kP = (i) => 0.20 + 0.07 * Math.sin(t * 3.0 - i * 1.1);
      const wob = S.moving ? 1 : 0.45;
      const zs = [-0.16 + 0.10 * Math.sin(ph) * wob, 0.02 + 0.13 * Math.sin(ph - 0.8) * wob, 0.18 + 0.17 * Math.sin(ph - 1.6) * wob];
      const sq = 1.0 + 0.10 * Math.sin(ph * 2.0);
      rmP(o, [0, 0.30 * sq, zs[0]], [0, 0.34 * sq, zs[0] + 0.02], 0.30, 0.26, CD, kP(0));
      rmP(o, [0, 0.36 * sq, zs[1]], [0, 0.42 * sq, zs[1] + 0.02], 0.27, 0.23, CB, kP(1));
      rmP(o, [0, 0.52 * sq, zs[2]], [0, 0.60 * sq, zs[2] + 0.02], 0.22, 0.19, CB, kP(2));
      rmP(o, [-0.26, 0.42 * sq, zs[1]], [-0.38, 0.30 + 0.08 * Math.sin(t * 2.6), zs[1] + 0.08], 0.09, 0.05, CB, 0.16);
      rmP(o, [0.26, 0.42 * sq, zs[1]], [0.38, 0.30 + 0.08 * Math.sin(t * 2.6 + 2), zs[1] + 0.08], 0.09, 0.05, CB, 0.16);
      const u = (t * 0.4) % 1, dx3 = 0.30, dz3 = -0.05;
      if (u < 0.35) {
        const q = u / 0.35;
        rmP(o, [dx3, 0.30 - q * 0.05, dz3], [dx3, 0.29 - q * 0.05, dz3], 0.02 + q * 0.09, 0.02 + q * 0.09, CB, 0.14 - q * 0.06);
      } else if (u < 0.7) {
        const v2 = (u - 0.35) / 0.35, yy = 0.25 - (0.25 - 0.06) * v2 * v2;
        rmP(o, [dx3 + v2 * 0.12, yy, dz3], [dx3 + v2 * 0.12, yy - 0.01, dz3], 0.11, 0.11, CB, 0.05);
      } else {
        const w2 = (u - 0.7) / 0.3;
        rmP(o, [dx3 + 0.12, 0.06, dz3], [dx3 + 0.12, 0.05, dz3], Math.max(0.11 * (1 - w2), 0.005), Math.max(0.11 * (1 - w2), 0.005), CD, 0.05 + w2 * 0.2);
      }
      spring(eye.L, zs[2] + 0.13, 40, 5, dt);
      spring(eye.R, zs[2] + 0.13, 46, 5.5, dt);
      rmEyes(o, t, [-0.085, 0.60 * sq, eye.L.x], [0.085, 0.60 * sq, eye.R.x], 0.052, true);
      rmUpload(o);
    };
    return ch;
  }

  /* ---- meshキャラ基盤 ---- */
  function meshBase(group, height) {
    const holder = new THREE.Group();
    holder.add(group);
    scene.add(holder);
    const sh = makeShadow(0.55);
    scene.add(sh);
    return {
      kind: 'mesh', holder, group, shadow: sh, height,
      place(x, y, ang, sy) {
        holder.position.set(x, y, 0);
        holder.rotation.y = ang;
        holder.scale.set(1 / Math.sqrt(Math.max(sy, 0.5)), sy, 1 / Math.sqrt(Math.max(sy, 0.5)));
        sh.position.x = x;
        const s = clamp(1 - y * 0.5, 0.3, 1);
        sh.scale.set(s, s, 1);
      },
      setVisible(v) { holder.visible = v; sh.visible = v; },
      dispose() {
        scene.remove(holder); scene.remove(sh);
        holder.traverse(m => {
          if (m.geometry) m.geometry.dispose();
          if (m.material) dropMat(m.material);
        });
        sh.geometry.dispose(); sh.material.dispose();
      },
    };
  }
  function mesh(g, m, p, parent) {
    const o = new THREE.Mesh(g, m);
    if (p) o.position.set(p[0], p[1], p[2]);
    parent.add(o);
    return o;
  }
  function bake(g, sx, sy, sz) { g.scale(sx, sy, sz); return g; }
  function triGeom(tris) {
    const pos = new Float32Array(tris.length * 9);
    for (let i = 0; i < tris.length; i++)
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++)
          pos[i * 9 + j * 3 + k] = tris[i][j][k];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }
  function withOutline(m, w) {
    m.add(new THREE.Mesh(m.geometry, outlineMat(w || 0.018)));
    return m;
  }

  /* ---- デジタマ: 風船風エッグ ---- */
  function makeEgg() {
    const g = new THREE.Group();
    const shell = toonMat(0xfffdf4, {});
    const spot = toonMat(0x7d95d8, {});
    const body = mesh(bake(new THREE.SphereGeometry(0.34, 20, 16), 1, 1.22, 1), shell, [0, 0.42, 0], g);
    // 水玉もよう
    const sp = [[0.6, 0.3], [2.2, 0.55], [3.6, 0.2], [5.0, 0.5], [1.4, 0.75]];
    for (const [a, h] of sp) {
      const s = mesh(bake(new THREE.SphereGeometry(0.085, 10, 8), 1, 1, 0.4), spot, [0, 0, 0], body);
      s.position.set(Math.cos(a) * 0.31, (h - 0.4) * 0.6, Math.sin(a) * 0.31);
      s.lookAt(0, s.position.y * 2, 0);
    }
    const ch = meshBase(g, 0.95);
    const wig = { x: 0, v: 0 };
    let wigT = 2 + Math.random() * 2;
    ch.update = (t, dt, S) => {
      const br = 1 + 0.025 * Math.sin(t * 2.0);
      body.scale.set(1, br, 1);
      if (t > wigT) { wigT = t + 1.6 + Math.random() * 2.5; wig.v += (Math.random() > 0.5 ? 1 : -1) * 9; }
      spring(wig, 0, 120, 4, dt);
      g.rotation.z = clamp(wig.x, -0.5, 0.5) * 0.35;
    };
    return ch;
  }

  /* ---- Shadow系: 墨絵キツネ（尻尾の本数で進化差）---- */
  function makeInkFox(p) {
    const PAPER = p.paper;
    const inkMat = (ink) => toonMat(PAPER, { mode: 'INK', ink });
    const g = new THREE.Group();
    g.scale.set(p.scale, p.scale, p.scale);
    const body = new THREE.Group(); g.add(body);
    function part(gg, ink, pp, parent, ow) {
      const m = mesh(gg, inkMat(ink), pp, parent || body);
      withOutline(m, ow || 0.018);
      return m;
    }
    part(bake(new THREE.SphereGeometry(0.34, 18, 14), 1, 0.82, 1.3), 0.05, [0, 0.52, 0]);
    part(new THREE.SphereGeometry(0.20, 14, 12), 0.0, [0, 0.50, 0.36]);
    const neck = new THREE.Group(); neck.position.set(0, 0.66, 0.40); body.add(neck);
    part(new THREE.SphereGeometry(0.23, 16, 12), 0.05, [0, 0.12, 0.10], neck);
    const sn = part(new THREE.ConeGeometry(0.09, 0.24, 10), 0.45, [0, 0.06, 0.30], neck, 0.014);
    sn.rotation.x = Math.PI / 2;
    const earL = new THREE.Group(); earL.position.set(-0.12, 0.28, 0.06); neck.add(earL);
    const earR = new THREE.Group(); earR.position.set(0.12, 0.28, 0.06); neck.add(earR);
    part(new THREE.ConeGeometry(0.085, 0.24, 8), 0.85, [0, 0.10, 0], earL, 0.014);
    part(new THREE.ConeGeometry(0.085, 0.24, 8), 0.85, [0, 0.10, 0], earR, 0.014);
    const legs = [];
    const lp = [[-0.16, 0.30], [0.16, 0.30], [-0.15, -0.26], [0.15, -0.26]];
    for (let i = 0; i < 4; i++) {
      const lg = new THREE.Group(); lg.position.set(lp[i][0], 0.35, lp[i][1]); body.add(lg);
      part(new THREE.CylinderGeometry(0.055, 0.05, 0.34, 8), 0.55, [0, -0.17, 0], lg, 0.013);
      legs.push(lg);
    }
    // 尻尾（本数=進化段階）
    const tails = [];
    for (let ti = 0; ti < p.tails; ti++) {
      const base = new THREE.Group();
      base.position.set(0, 0.56, -0.40);
      base.rotation.y = (ti - (p.tails - 1) / 2) * 0.55;
      body.add(base);
      const segs = [];
      let tparent = base;
      const td = [0.16, 0.13, 0.10];
      for (let j = 0; j < 3; j++) {
        const g2 = new THREE.Group(); g2.position.set(0, 0.04, -0.16); tparent.add(g2);
        part(new THREE.SphereGeometry(td[j], 12, 10), j * 0.15, [0, 0, 0], g2);
        segs.push(g2); tparent = g2;
      }
      const tt = part(new THREE.ConeGeometry(0.085, 0.2, 8), 0.95, [0, 0.02, -0.14], tparent, 0.014);
      tt.rotation.x = -Math.PI / 2;
      tails.push({ segs, phase: ti * 1.3 });
    }
    const ch = meshBase(g, 1.15 * p.scale);
    const earTw = { x: 0, v: 0 };
    let earNext = 2;
    ch.update = (t, dt, S) => {
      const br = 1 + 0.02 * Math.sin(t * 2.2);
      body.scale.set(1, br, 1);
      neck.rotation.y = 0.35 * Math.sin(t * 0.5) + 0.1 * Math.sin(t * 1.7);
      neck.rotation.x = 0.08 * Math.sin(t * 0.8 + 2);
      if (t > earNext) { earNext = t + 2 + Math.random() * 3; earTw.v += 14; }
      spring(earTw, 0, 180, 10, dt);
      earL.rotation.z = 0.15 + earTw.x * 0.12;
      earR.rotation.z = -0.15 - earTw.x * 0.09;
      const gait = S.moving ? 0.55 : 0.08;
      for (let i = 0; i < 4; i++) {
        legs[i].rotation.x = Math.sin(t * S.speedMul * 5.2 + (i % 2 ? 0 : Math.PI) + (i < 2 ? 0 : Math.PI / 2)) * gait;
      }
      for (const tl of tails) {
        for (let i = 0; i < 3; i++) {
          tl.segs[i].rotation.y = Math.sin(t * S.speedMul * 2.4 - i * 0.9 + tl.phase) * 0.35;
          tl.segs[i].rotation.x = 0.35 + Math.sin(t * S.speedMul * 1.2 - i * 0.6 + tl.phase) * 0.12;
        }
      }
    };
    return ch;
  }

  /* ---- Gale系: 折り紙ヅル ---- */
  function makeCrane(p) {
    const P = toonMat(0xfffdf4, { mode: 'PAPER', accent: p.accent, side: THREE.DoubleSide });
    const g = new THREE.Group();
    g.scale.set(p.scale, p.scale, p.scale);
    const body = new THREE.Group(); body.position.y = 1.0; g.add(body);
    const N = [0, 0.04, 0.62], TT = [0, 0.42, -0.85], A = [0, 0.20, 0.05], B = [0.17, 0, 0], C = [0, -0.13, 0.05], D = [-0.17, 0, 0];
    body.add(new THREE.Mesh(triGeom([
      [N, A, B], [N, B, C], [N, C, D], [N, D, A],
      [TT, B, A], [TT, C, B], [TT, D, C], [TT, A, D]
    ]), P));
    const neck = new THREE.Group(); neck.position.set(0, 0.08, 0.52); body.add(neck);
    neck.add(new THREE.Mesh(triGeom([
      [[-0.03, 0, 0], [0.03, 0, 0], [0.02, 0.42, 0.38]],
      [[-0.03, 0, 0], [0.02, 0.42, 0.38], [-0.02, 0.42, 0.38]]
    ]), P));
    const head = new THREE.Group(); head.position.set(0, 0.42, 0.38); neck.add(head);
    head.add(new THREE.Mesh(triGeom([
      [[-0.02, 0, 0], [0.02, 0, 0], [0, -0.12, 0.24]],
      [[0.02, 0, 0], [-0.02, 0, 0], [0, 0.05, 0.10]]
    ]), P));
    function wing(s) {
      const wg = new THREE.Group(); wg.position.set(0, 0.18, 0.05); body.add(wg);
      wg.add(new THREE.Mesh(triGeom([
        [[0, 0, -0.17], [0, 0, 0.21], [s * 0.5, 0, 0.16]],
        [[0, 0, -0.17], [s * 0.5, 0, 0.16], [s * 0.5, 0, -0.14]]
      ]), P));
      const tip = new THREE.Group(); tip.position.set(s * 0.5, 0, 0); wg.add(tip);
      tip.add(new THREE.Mesh(triGeom([
        [[0, 0, -0.14], [0, 0, 0.16], [s * 0.55, 0, 0.0]]
      ]), P));
      return { g: wg, tip, lag: { x: 0, v: 0 } };
    }
    const wL = wing(-1), wR = wing(1);
    const ch = meshBase(g, 1.6 * p.scale);
    ch.flying = true;
    const flapEnv = { x: 0, v: 0 };
    let burstT = 2.5;
    ch.update = (t, dt, S) => {
      if (t > burstT) { burstT = t + 3 + Math.random() * 3; flapEnv.v += 9; }
      spring(flapEnv, 0, 14, 3.5, dt);
      const amp = 0.28 + clamp(flapEnv.x, 0, 1.1) * 0.6 + (S.moving ? 0.1 : 0);
      const w = t * S.speedMul * 7.5;
      const fl = Math.sin(w) * amp;
      wL.g.rotation.z = -fl; wR.g.rotation.z = fl;
      spring(wL.lag, -fl * 0.8, 120, 9, dt); spring(wR.lag, fl * 0.8, 120, 9, dt);
      wL.tip.rotation.z = wL.lag.x - (-fl); wR.tip.rotation.z = wR.lag.x - fl;
      body.position.y = 1.0 + 0.14 * Math.sin(t * 1.15) + clamp(flapEnv.x, 0, 1) * 0.25;
      body.rotation.z = 0.06 * Math.sin(t * 0.9);
      body.rotation.x = -0.05 + 0.04 * Math.sin(t * 1.3 + 1);
      neck.rotation.x = 0.10 * Math.sin(t * 2.1);
      head.rotation.x = 0.15 * Math.sin(t * 2.1 + 0.6);
    };
    return ch;
  }

  /* ---- ダークウォリアー: 切り絵（影絵人形+月）---- */
  function makeKirie() {
    const INKC = 0x151020;
    const F = () => toonMat(INKC, { mode: 'FLAT2D', side: THREE.DoubleSide });
    const GOLD = toonMat(0xd9a441, { mode: 'FLAT2D', side: THREE.DoubleSide });
    const g = new THREE.Group();
    const pup = new THREE.Group(); pup.position.y = 0.1; pup.scale.set(1.5, 1.5, 1); g.add(pup);
    function piece(shape, z, mat) {
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 14), mat || F());
      m.position.z = z; return m;
    }
    // 影絵ボディ（切り抜き穴つき）
    const bs = new THREE.Shape();
    bs.moveTo(-0.38, 0.06);
    bs.quadraticCurveTo(-0.50, 0.35, -0.30, 0.55);
    bs.quadraticCurveTo(-0.05, 0.72, 0.20, 0.66);
    bs.quadraticCurveTo(0.55, 0.55, 0.58, 0.28);
    bs.quadraticCurveTo(0.60, 0.05, 0.40, 0.03);
    bs.quadraticCurveTo(0.00, -0.02, -0.38, 0.06);
    [[0.28, 0.32, 0.075], [0.10, 0.45, 0.055], [0.40, 0.14, 0.05]].forEach(h => {
      const pth = new THREE.Path(); pth.absarc(h[0], h[1], h[2], 0, Math.PI * 2, true); bs.holes.push(pth);
    });
    pup.add(piece(bs, 0));
    const edge = piece(bs, -0.015, GOLD); edge.scale.set(1.045, 1.06, 1); pup.add(edge);
    const headG = new THREE.Group(); headG.position.set(-0.26, 0.62, 0.01); pup.add(headG);
    const hs = new THREE.Shape(); hs.absarc(0, 0, 0.20, 0, Math.PI * 2, false);
    headG.add(piece(hs, 0));
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.028, 10), toonMat(0xffe9b8, { mode: 'FLAT2D' }));
    eye.position.set(-0.06, 0.03, 0.006); headG.add(eye);
    function ear(rot, px) {
      const eg = new THREE.Group(); eg.position.set(px, 0.14, 0.002); eg.rotation.z = rot; headG.add(eg);
      const es = new THREE.Shape();
      es.moveTo(0, 0); es.quadraticCurveTo(-0.09, 0.32, -0.02, 0.62); es.quadraticCurveTo(0.07, 0.30, 0, 0);
      eg.add(piece(es, 0));
      return eg;
    }
    const earA = ear(0.12, 0.02), earB = ear(-0.18, 0.10);
    // 月のバックライト（切り絵の様式美）: 不透明コア+ハローで昼空でも見える
    const mc = document.createElement('canvas'); mc.width = 128; mc.height = 128;
    const mx = mc.getContext('2d');
    let mg = mx.createRadialGradient(64, 64, 4, 64, 64, 64);
    mg.addColorStop(0, 'rgba(255,246,214,1)');
    mg.addColorStop(0.42, 'rgba(255,240,190,1)');
    mg.addColorStop(0.55, 'rgba(255,232,160,0.55)');
    mg.addColorStop(1, 'rgba(255,225,140,0)');
    mx.fillStyle = mg; mx.fillRect(0, 0, 128, 128);
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(mc), transparent: true, depthWrite: false,
    }));
    moon.position.set(0.25, 1.55, -0.55); moon.scale.set(1.9, 1.9, 1);
    g.add(moon);
    const ch = meshBase(g, 1.5);
    ch.billboardY = true;  // 切り絵は薄板なので常にカメラへ正対
    const earSw = { x: 0, v: 0 };
    let hopT = 3.5, hop = -1;
    ch.update = (t, dt, S) => {
      pup.rotation.z = 0.05 * Math.sin(t * 0.9);
      headG.rotation.z = 0.08 * Math.sin(t * 1.2 + 1);
      spring(earSw, 0.12 * Math.sin(t * 1.6), 60, 5, dt);
      earA.rotation.z = 0.12 + earSw.x;
      earB.rotation.z = -0.18 + earSw.x * 1.4;
      if (hop < 0 && t > hopT) hop = 0;
      if (hop >= 0) {
        hop += dt * 1.6 * S.speedMul;
        if (hop < 1) {
          pup.position.y = 0.1 + 0.45 * 4 * hop * (1 - hop) * 0.4;
          earSw.v -= dt * 30;
        } else { hop = -1; hopT = t + 3.5 + Math.random() * 3; pup.position.y = 0.1; }
      }
    };
    return ch;
  }

  /* ---- ゴースト（死亡演出）---- */
  function makeGhost() {
    const g = new THREE.Group();
    const M = toonMat(0xf3f0ff, {});
    const body = mesh(bake(new THREE.SphereGeometry(0.3, 14, 12), 1, 1.25, 1), M, [0, 0.4, 0], g);
    const E = toonMat(0x241a2e, {});
    mesh(new THREE.SphereGeometry(0.045, 8, 8), E, [-0.1, 0.5, 0.26], g);
    mesh(new THREE.SphereGeometry(0.045, 8, 8), E, [0.1, 0.5, 0.26], g);
    for (let i = 0; i < 4; i++) {
      mesh(new THREE.ConeGeometry(0.09, 0.2, 8), M, [(i - 1.5) * 0.15, -0.02, 0], g).rotation.x = Math.PI;
    }
    const ch = meshBase(g, 1.0);
    ch.update = (t, dt) => {
      g.position.y = 0.5 + 0.5 * Math.min((t - ch.bornT) * 0.3, 1.2) + 0.08 * Math.sin(t * 1.8);
      g.rotation.y = 0.3 * Math.sin(t * 0.7);
      body.scale.y = 1.25 + 0.06 * Math.sin(t * 2.4);
    };
    return ch;
  }

  /* ---- 種族→ビルダー対応表 ---- */
  const CHAR_DEFS = {
    digitama: () => makeEgg(),
    slime: () => makeSlime({ scale: 0.9, body: [0.42, 0.85, 0.55], dark: [0.30, 0.70, 0.45] }),
    blaze_kid: () => makeKolo({
      scale: 0.8, body: [1.0, 0.63, 0.43], limb: [0.94, 0.49, 0.32],
      foot: [1.0, 0.85, 0.68], belly: [1.0, 0.93, 0.84], ear: [1.0, 0.56, 0.68], earUp: 0.20,
    }),
    blaze_warrior: () => makeKolo({
      scale: 1.02, body: [0.93, 0.36, 0.28], limb: [0.80, 0.28, 0.24],
      foot: [1.0, 0.78, 0.55], belly: [1.0, 0.88, 0.72], ear: [1.0, 0.45, 0.30], earUp: 0.26,
      horn: true, hornCol: [1.0, 0.85, 0.45],
    }),
    blaze_lord: () => makeKolo({
      scale: 1.28, body: [0.80, 0.22, 0.24], limb: [0.62, 0.16, 0.20],
      foot: [1.0, 0.72, 0.40], belly: [1.0, 0.82, 0.58], ear: [1.0, 0.60, 0.25], earUp: 0.30,
      horn: true, hornCol: [1.0, 0.78, 0.30],
    }),
    shadow_kid: () => makeInkFox({ scale: 0.8, tails: 1, paper: 0xf6f1e6 }),
    shadow_warrior: () => makeInkFox({ scale: 1.05, tails: 2, paper: 0xefe6e6 }),
    shadow_lord: () => makeInkFox({ scale: 1.3, tails: 3, paper: 0xe9dff0 }),
    gale_kid: () => makeCrane({ scale: 0.85, accent: 0xe8503f }),
    gale_warrior: () => makeCrane({ scale: 1.1, accent: 0x3f8fe8 }),
    gale_lord: () => makeCrane({ scale: 1.35, accent: 0xd9a441 }),
    numemon: () => makeClay({ scale: 0.95, body: [0.55, 0.55, 0.35], limb: [0.44, 0.46, 0.28], belly: [0.72, 0.72, 0.50] }),
    dark_warrior: () => makeKirie(),
  };
  const STATIONARY = { digitama: true };

  /* ---- ひとりあそび（種族の性格が出るアイドル芸）---- */
  function doAntic(a) {
    const pool = a.char.flying ? ['loop', 'spin', 'greet'] : ['bigjump', 'spin', 'stretch', 'greet'];
    const kind = pool[Math.floor(Math.random() * pool.length)];
    a.paused = 2.6;
    if (kind === 'spin') {
      // くるっと一回転
      sfx('pop');
      tween(0.7, u => { a.spin = easeInOut(u) * Math.PI * 2; }, () => { a.spin = 0; });
    } else if (kind === 'bigjump') {
      // ためてジャンプ
      a.squash.v -= 4;
      after(0.28, () => {
        sfx('hop');
        tween(0.55, u => { a.hopY = 4 * u * (1 - u) * 0.5; }, () => { a.hopY = 0; });
        a.squash.v += 5;
      });
    } else if (kind === 'loop') {
      // 飛行種族: ふわっと宙返り
      sfx('hop');
      tween(1.0, u => {
        a.hopY = Math.sin(u * Math.PI) * 0.55;
        a.spin = easeInOut(u) * Math.PI * 2;
      }, () => { a.hopY = 0; a.spin = 0; });
    } else if (kind === 'stretch') {
      // うーんと伸び
      a.squash.v += 3.2;
      after(0.7, () => { a.squash.v -= 2; });
    } else if (kind === 'greet') {
      // カメラに気づいてこっちを見る
      a.mode = 'posed';
      a.facingWant = Math.atan2(camera.position.x - a.walkX, camera.position.z);
      a.paused = 2.2;
      after(0.7, () => { a.squash.v += 2.5; if (Math.random() < 0.5) burst(a.headPos(), '✨', 2, { size: 0.14, vy: 0.7, life: 0.7 }); });
      after(2.0, () => { if (a.mode === 'posed') a.mode = 'free'; });
    }
  }

  /* ============ アクター（キャラ+振る舞い状態）============ */
  function makeActor(speciesId) {
    const build = CHAR_DEFS[speciesId] || CHAR_DEFS.slime;
    const a = {
      speciesId,
      char: build(),
      walkX: 0, walkDir: 1, facing: Math.PI / 2,
      hopY: 0, squash: { x: 0, v: 0 }, flatY: 1,
      spin: 0,        // アイドル芸用の追加回転
      shake: 0,       // 首振り(いやいや)残り時間
      paused: 0,      // 歩行停止残り時間
      idleT: 5 + Math.random() * 6,  // 次のひとりあそびまで
      home: 0,        // 定位置（バトルで移動）
      mode: 'free',   // free | posed
    };
    a.update = (t, dt, env) => {
      // env: {sleeping, sick, moving許可}
      const moving = a.mode === 'free' && !env.sleeping && a.paused <= 0 && !STATIONARY[speciesId];
      if (moving) {
        const sp = env.sick ? 0.25 : (env.hungry ? 0.32 : 0.55);
        a.walkX += a.walkDir * sp * dt;
        if (a.walkX > 1.6) { a.walkX = 1.6; a.walkDir = -1; }
        if (a.walkX < -1.6) { a.walkX = -1.6; a.walkDir = 1; }
        if (Math.random() < dt * 0.15) a.paused = 1.5 + Math.random() * 2;  // ときどき立ち止まる
      } else if (a.paused > 0) a.paused -= dt;
      // ひとりあそび（元気で暇な時だけ）
      if (a.mode === 'free' && !env.sleeping && !env.sick && !env.hungry && !busy && !STATIONARY[speciesId]) {
        a.idleT -= dt;
        if (a.idleT <= 0) { a.idleT = 9 + Math.random() * 9; doAntic(a); }
      }
      const wantFacing = a.char.billboardY
        ? Math.atan2(camera.position.x - a.walkX, camera.position.z)
        : (a.mode === 'free' ? (a.walkDir > 0 ? Math.PI / 2 : -Math.PI / 2) : a.facingWant);
      let dAng = (wantFacing - a.facing + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      a.facing += dAng * Math.min(dt * 6, 1);
      spring(a.squash, 0, 90, 7, dt);
      let sy = (1 + clamp(a.squash.x, -0.45, 0.6)) * a.flatY;
      let x = a.walkX;
      if (a.shake > 0) { a.shake -= dt; x += Math.sin(T * 30) * 0.04; }
      const speedMul = env.sleeping ? 0.3 : (env.sick ? 0.5 : (env.hungry ? 0.65 : 1));
      if (env.sleeping) sy *= 0.92 + 0.03 * Math.sin(t * 1.2);
      else if (env.hungry || env.sick) sy *= 0.955;  // しょんぼりうなだれる
      a.char.place(x, a.hopY, a.facing + a.spin, sy);
      a.char.update(t, dt, { moving: moving && !env.sleeping, speedMul, sleeping: env.sleeping, sick: env.sick });
    };
    a.pop = () => { a.squash.v += 5.5; };
    a.headPos = () => [a.walkX, a.char.height + a.hopY + 0.15, 0];
    a.center = () => [a.walkX, a.char.height * 0.55 + a.hopY, 0];
    a.dispose = () => a.char.dispose();
    return a;
  }

  /* ============ 小道具 ============ */
  let propMeat, propProtein, propDumbbell;
  function buildProps() {
    // 肉（骨付き）
    propMeat = new THREE.Group();
    const meatM = toonMat(0xc0714f, {}), boneM = toonMat(0xfff6e8, {});
    mesh(bake(new THREE.SphereGeometry(0.16, 12, 10), 1.25, 1, 1), meatM, [0, 0.16, 0], propMeat);
    const bone = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.28, 8), boneM, [0.16, 0.1, 0], propMeat);
    bone.rotation.z = 0.9;
    mesh(new THREE.SphereGeometry(0.05, 8, 8), boneM, [0.28, 0.19, 0], propMeat);
    propMeat.visible = false; scene.add(propMeat);
    // プロテイン（シェイカー）
    propProtein = new THREE.Group();
    const canM = toonMat(0xf3ead2, {}), capM = toonMat(0xe8503f, {});
    mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.3, 12), canM, [0, 0.16, 0], propProtein);
    mesh(new THREE.CylinderGeometry(0.06, 0.11, 0.1, 12), capM, [0, 0.36, 0], propProtein);
    propProtein.visible = false; scene.add(propProtein);
    // ダンベル
    propDumbbell = new THREE.Group();
    const dM = toonMat(0x5e5a6b, {}), hM = toonMat(0xd9b34a, {});
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), hM, [0, 0, 0], propDumbbell).rotation.z = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.09, 12), dM, [-0.22, 0, 0], propDumbbell).rotation.z = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.09, 12), dM, [0.22, 0, 0], propDumbbell).rotation.z = Math.PI / 2;
    propDumbbell.visible = false; scene.add(propDumbbell);
  }

  /* ---- うんち（粘土風・12fpsぷるぷる）---- */
  const poopGroup = [];
  function makePoop(i) {
    const g = new THREE.Group();
    const M = toonMat(0x9a6b3f, {});
    mesh(new THREE.SphereGeometry(0.13, 10, 8), M, [0, 0.09, 0], g);
    mesh(new THREE.SphereGeometry(0.095, 10, 8), M, [0.015, 0.21, 0], g);
    mesh(new THREE.SphereGeometry(0.06, 10, 8), M, [0.025, 0.30, 0], g);
    const slots = [[-2.1, -0.7], [2.15, -0.5], [-1.7, 0.8], [1.75, 0.75], [-2.4, 0.3], [2.4, 0.2], [-1.3, -1.0], [1.3, 1.05]];
    const s = slots[i % slots.length];
    g.position.set(s[0], 0, s[1]);
    scene.add(g);
    return g;
  }

  /* ---- 月（夜）---- */
  let moonSprite;

  /* ============ 公開状態 ============ */
  let actor = null;          // メインモンスター
  let opponent = null;       // バトル相手
  let ghost = null;          // 死亡ゴースト
  const env = { sleeping: false, sick: false, hungry: false };
  let nightWant = 0;
  let busy = false;          // リアクション中（歩行停止）
  const api = {};

  /* ============ init ============ */
  api.init = function (canvasEl) {
    canvas = canvasEl;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);

    // 空
    {
      const g = new THREE.SphereGeometry(90, 24, 16);
      const m = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { uDay: DAY },
        vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: [
          'varying vec3 vP; uniform float uDay;',
          'void main(){',
          '  float h=normalize(vP).y;',
          '  vec3 topD=vec3(0.42,0.52,0.83); vec3 horD=vec3(0.99,0.84,0.66);',
          '  vec3 topN=vec3(0.05,0.07,0.18); vec3 horN=vec3(0.16,0.15,0.32);',
          '  vec3 top=mix(topN,topD,uDay); vec3 hor=mix(horN,horD,uDay);',
          '  vec3 c=mix(hor,top,smoothstep(-0.05,0.5,h));',
          '  gl_FragColor=vec4(c,1.0);',
          '}'].join('\n')
      });
      scene.add(new THREE.Mesh(g, m));
    }
    // 地面
    {
      const g = new THREE.PlaneGeometry(70, 70);
      const m = new THREE.ShaderMaterial({
        uniforms: { uDay: DAY, uTint: { value: new THREE.Color(0x9fd8c4) } },
        vertexShader: 'varying vec3 vWP; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vWP=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp;}',
        fragmentShader: [
          'uniform float uDay; uniform vec3 uTint; varying vec3 vWP;',
          'void main(){',
          '  vec3 col=vec3(0.93,0.88,0.78);',
          '  float d=length(vWP.xz);',
          '  col=mix(col,uTint,smoothstep(3.2,0.8,d)*0.4);',
          '  vec2 gq=fract(vWP.xz*0.9)-0.5;',
          '  col*=1.0-smoothstep(0.1,0.06,length(gq))*0.05;',
          '  vec3 horD=vec3(0.99,0.84,0.66); vec3 horN=vec3(0.16,0.15,0.32);',
          '  col=mix(col,mix(horN,horD,uDay),smoothstep(8.0,26.0,d));',
          '  col*=mix(vec3(0.4,0.42,0.7),vec3(1.0),uDay);',
          '  gl_FragColor=vec4(col,1.0);',
          '}'].join('\n')
      });
      const gm = new THREE.Mesh(g, m);
      gm.rotation.x = -Math.PI / 2;
      scene.add(gm);
      api._ground = m;
    }
    // blob shadowプロトタイプ
    shadowProto = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying vec2 vUv; uniform float uA; void main(){ float d=length(vUv-0.5)*2.0; gl_FragColor=vec4(vec3(0.15,0.13,0.2),smoothstep(1.0,0.35,d)*uA);}',
      uniforms: { uA: { value: 0.35 } }
    });
    // 塵
    {
      const n = 60, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() * 2 - 1) * 8; pos[i * 3 + 1] = Math.random() * 3 + 0.3; pos[i * 3 + 2] = (Math.random() * 2 - 1) * 4; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const m = new THREE.PointsMaterial({ color: 0xfff6dd, size: 0.04, transparent: true, opacity: 0.55 });
      api._motes = { pts: new THREE.Points(g, m), pos, n, mat: m };
      scene.add(api._motes.pts);
    }
    // 月
    {
      moonSprite = new THREE.Mesh(new THREE.CircleGeometry(1.2, 40), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uT: { value: 0 }, uA: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: [
          'varying vec2 vUv; uniform float uT; uniform float uA;',
          'void main(){ float d=length(vUv-0.5)*2.0;',
          ' float core=smoothstep(0.85,0.4,d);',
          ' float halo=smoothstep(1.0,0.55,d)*0.5;',
          ' float pulse=0.92+0.08*sin(uT*0.7);',
          ' gl_FragColor=vec4(vec3(1.0,0.93,0.75),(core+halo)*pulse*uA);}'
        ].join('\n')
      }));
      moonSprite.position.set(-2.4, 3.4, -5);
      scene.add(moonSprite);
      MATS.push(moonSprite.material);
      moonSprite.material.uniforms.uTime = moonSprite.material.uniforms.uT; // uTime更新に相乗り
    }
    emoteAlert = makeEmote('❗', 0.34);
    emoteSick = makeEmote('💫', 0.3);
    buildProps();
    bindInput();
    resize();
    window.addEventListener('resize', resize);
    lastNow = performance.now();
    requestAnimationFrame(loop);
  };

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 縦長画面では水平視野を維持する（歩行範囲±1.6が画面外に出ないよう垂直FOVを広げる）
    const BASE_FOV = 42, BASE_ASPECT = 1.6;
    if (camera.aspect < BASE_ASPECT) {
      const hFov = 2 * Math.atan(Math.tan(BASE_FOV * Math.PI / 360) * BASE_ASPECT);
      camera.fov = Math.min(72, 2 * Math.atan(Math.tan(hFov / 2) / camera.aspect) * 180 / Math.PI);
    } else {
      camera.fov = BASE_FOV;
    }
    camera.updateProjectionMatrix();
  }

  /* ============ input（ドラッグ回転・ホイールズーム・タップでなでる）============ */
  function bindInput() {
    let dragging = false, moved = 0, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', e => { dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      moved += Math.abs(dx) + Math.abs(dy);
      cam.dragAz += dx * 0.007;
      cam.dragEl = clamp(cam.dragEl + dy * 0.004, -0.1, 0.5);
      lx = e.clientX; ly = e.clientY;
    });
    canvas.addEventListener('pointerup', e => {
      if (dragging && moved < 7 && actor && api.onPet) {
        // モンスター付近のタップ判定（スクリーン座標で概算）
        const v = new THREE.Vector3(actor.walkX, actor.char.height * 0.5, 0).project(camera);
        const sx = (v.x * 0.5 + 0.5) * canvas.clientWidth, sy2 = (-v.y * 0.5 + 0.5) * canvas.clientHeight;
        const r = Math.hypot(e.offsetX - sx, e.offsetY - sy2);
        if (r < 110) api.onPet();
      }
      dragging = false;
    });
    canvas.addEventListener('wheel', e => {
      cam.wantDist = clamp(cam.wantDist + e.deltaY * 0.005, 2.6, 9);
      e.preventDefault();
    }, { passive: false });
  }

  /* ============ 公開API ============ */
  const TYPE_TINT = {
    blaze: 0xf0b184, shadow: 0xc4b6e0, gale: 0xa9dcc9, neutral: 0xbfd8a8,
  };

  api.setSpecies = function (speciesId, monsterType) {
    if (actor && actor.speciesId === speciesId) return;
    const oldX = actor ? actor.walkX : 0;
    if (actor) actor.dispose();
    actor = makeActor(speciesId);
    actor.walkX = oldX;
    actor.pop();
    if (api._ground) api._ground.uniforms.uTint.value.set(TYPE_TINT[monsterType] || TYPE_TINT.neutral);
  };

  api.setNight = function (n) { nightWant = n ? 0 : 1; };
  api.setSleeping = function (s) { env.sleeping = s; };
  api.setSick = function (s) { env.sick = s; };
  api.setHungry = function (h) { env.hungry = h; };
  api.setAlert = function (a) { api._alert = a; };
  api.setPoops = function (n) {
    while (poopGroup.length < n) poopGroup.push(makePoop(poopGroup.length));
    while (poopGroup.length > n) {
      const g = poopGroup.pop();
      scene.remove(g);
      g.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) dropMat(m.material); });
    }
  };

  /* ---- リアクション ---- */
  api.react = function (type) {
    if (!actor) return;
    const A = actor;
    if (type === 'eat' || type === 'protein') {
      busy = true; A.paused = 4;
      const prop = type === 'eat' ? propMeat : propProtein;
      const px = A.walkX + (A.walkDir > 0 ? 0.7 : -0.7);
      const py = A.char.flying ? A.char.height * 0.62 : 0;  // 飛行種族は空中に差し出す
      prop.position.set(px, py, 0.25);
      prop.scale.set(1, 1, 1); prop.visible = true;
      A.facingWant = px > A.walkX ? Math.PI / 2 : -Math.PI / 2;
      A.mode = 'posed';
      for (let i = 0; i < 3; i++) {
        after(0.5 + i * 0.55, () => {
          A.squash.v += 4;
          prop.scale.multiplyScalar(0.72);
          sfx('munch');
          burst([px, py + 0.45, 0.25], '✨', 2, { size: 0.14, vy: 0.9, life: 0.6 });
        });
      }
      after(2.3, () => {
        prop.visible = false;
        sfx('gulp');
        burst(A.headPos(), '💕', 6, { size: 0.2 });
        A.pop();
      });
      after(3.0, () => { A.mode = 'free'; busy = false; });
    } else if (type === 'train') {
      busy = true; A.paused = 4.5; A.mode = 'posed'; A.facingWant = 0;  // 正面を向く
      propDumbbell.visible = true;
      for (let i = 0; i < 3; i++) {
        after(0.4 + i * 0.7, () => {
          A.squash.v -= 3.5;
          sfx('hop');
          tween(0.6, u => {
            const h = 4 * u * (1 - u);
            A.hopY = h * 0.4;
            propDumbbell.position.set(A.walkX, A.char.height * 0.6 + h * 0.5, 0.3);
          });
          after(0.32, () => { sfx('sweat'); burst([A.walkX, 0.8, 0.3], '💦', 2, { size: 0.15, vy: 1.2, life: 0.7 }); });
        });
      }
      after(2.9, () => {
        propDumbbell.visible = false;
        sfx('pop');
        burst(A.headPos(), '💪', 5, { size: 0.22 });
        A.pop();
      });
      after(3.5, () => { A.mode = 'free'; A.hopY = 0; busy = false; });
    } else if (type === 'clean') {
      // うんちが飛んでいく
      sfx('sweep');
      after(0.35, () => sfx('sparkle'));
      poopGroup.forEach((g, i) => {
        after(i * 0.12, () => {
          burst([g.position.x, 0.3, g.position.z], '✨', 4, { size: 0.16 });
          tween(0.5, u => {
            g.position.y = u * 3.2;
            g.position.x += (g.position.x > 0 ? 1 : -1) * u * 0.15;
            g.scale.setScalar(1 - u * 0.8);
          }, () => { g.visible = false; });
        });
      });
      after(0.9, () => { api.setPoops(0); if (actor) actor.pop(); });
    } else if (type === 'medicine') {
      busy = true; A.paused = 3;
      A.shake = 0.7;
      after(0.9, () => {
        sfx('heal');
        burst(A.headPos(), '✚', 5, { size: 0.2, vy: 1.0 });
        A.pop();
      });
      after(1.8, () => { busy = false; });
    } else if (type === 'pet') {
      sfx('pop');
      A.squash.v += 4.5;
      burst(A.headPos(), '💕', 4, { size: 0.2 });
    } else if (type === 'refuse') {
      sfx('buzz');
      A.shake = 0.6;
      burst(A.headPos(), '💢', 2, { size: 0.22, vy: 0.8, life: 0.7 });
      // ぷいっとそっぽを向く
      A.mode = 'posed'; A.paused = 2;
      A.facingWant = -Math.atan2(camera.position.x - A.walkX, camera.position.z);  // カメラの反対側
      after(1.5, () => { if (A.mode === 'posed') A.mode = 'free'; });
    }
  };

  /* ---- 進化 ---- */
  api.playEvolution = function (newSpeciesId, monsterType, onFlash, onDone) {
    if (!actor) return;
    busy = true;
    actor.mode = 'posed'; actor.facingWant = 0; actor.paused = 9;
    // 収束するキラキラ
    const c = actor.center();
    const iv = setInterval(() => {
      const a = Math.random() * Math.PI * 2, r = 1.4;
      burst([c[0] + Math.cos(a) * r, c[1] + Math.random() * 1.2 - 0.3, Math.sin(a) * r], '✨', 1,
        { size: 0.18, vx: -Math.cos(a) * 2.2, vy: 0, g: 0, speed: 0.1, life: 0.55 });
    }, 70);
    after(1.5, () => {
      clearInterval(iv);
      sfx('evolve');
      if (onFlash) onFlash();
      api.setSpecies(newSpeciesId, monsterType);
      actor.mode = 'posed'; actor.facingWant = 0; actor.paused = 2.5;
      actor.squash.v += 7;
      burst(actor.center(), '🌟', 12, { size: 0.24, speed: 2.2 });
      burst(actor.center(), '✨', 10, { size: 0.16, speed: 1.6 });
    });
    after(3.6, () => { if (actor) actor.mode = 'free'; busy = false; if (onDone) onDone(); });
  };

  /* ---- バトル ---- */
  api.playBattle = function (result, oppSpeciesId, cb) {
    if (!actor || busy) { if (cb && cb.done) cb.done(); return; }
    busy = true;
    const A = actor;
    A.mode = 'posed'; A.paused = 99;
    A.facingWant = Math.PI / 2;  // 右（敵の方向）
    opponent = makeActor(oppSpeciesId);
    opponent.mode = 'posed'; opponent.paused = 99;
    opponent.walkX = 3.6; opponent.facing = -Math.PI / 2; opponent.facingWant = -Math.PI / 2;
    const oldDist = cam.wantDist;
    cam.wantDist = Math.min(oldDist + 1.2, 7);
    // 入場
    const startX = A.walkX;
    tween(0.9, u => {
      const e = easeOut(u);
      A.walkX = lerp(startX, -1.25, e);
      opponent.walkX = lerp(3.6, 1.25, e);
    });
    let tt = 1.3;
    const rounds = result.rounds || [];
    rounds.forEach((r, i) => {
      after(tt, () => {
        if (cb && cb.round) cb.round(i, r.player_won);
        // 突進
        sfx('dash');
        tween(0.22, u => {
          const e = easeInOut(u);
          A.walkX = -1.25 + e * 0.85;
          opponent.walkX = 1.25 - e * 0.85;
        });
        after(0.24, () => {
          sfx('impact');
          burst([0, 0.9, 0], '💥', 3, { size: 0.32, speed: 1.2, vy: 0.6, life: 0.55 });
          burst([0, 0.9, 0], '⭐', 5, { size: 0.2, speed: 2.4 });
          cam.shake = 0.25;
          const loser = r.player_won ? opponent : A;
          const winner = r.player_won ? A : opponent;
          loser.squash.v -= 5;
          winner.squash.v += 2.5;
          tween(0.4, u => {
            const e = easeOut(u);
            A.walkX = lerp(A.walkX, r.player_won ? -1.0 : -1.6, e);
            opponent.walkX = lerp(opponent.walkX, r.player_won ? 1.6 : 1.0, e);
          });
        });
      });
      tt += 1.05;
    });
    // 決着
    after(tt + 0.2, () => {
      const winA = result.won;
      const winner = winA ? A : opponent;
      const loser = winA ? opponent : A;
      loser.flatY = 0.35;
      loser.squash.v -= 4;
      sfx(winA ? 'fanfare' : 'sad');
      burst(winner.headPos(), winA ? '🎉' : '😤', 8, { size: 0.24, speed: 2 });
      for (let i = 0; i < 3; i++) {
        after(0.25 + i * 0.4, () => {
          tween(0.36, u => { winner.hopY = 4 * u * (1 - u) * 0.35; });
        });
      }
      if (cb && cb.result) cb.result(winA);
    });
    after(tt + 2.2, () => {
      // 相手退場
      tween(0.7, u => { opponent.walkX = lerp(opponent.walkX, 4.2, easeInOut(u)); });
      after(0.75, () => {
        if (opponent) { opponent.dispose(); opponent = null; }
        A.flatY = 1; A.hopY = 0; A.mode = 'free'; A.paused = 0;
        cam.wantDist = oldDist;
        busy = false;
        if (cb && cb.done) cb.done();
      });
    });
  };

  /* ---- 死亡/復活 ---- */
  api.playDeath = function () {
    if (!actor) return;
    const c = actor.center();
    sfx('sad');
    burst(c, '💨', 6, { size: 0.26, vy: 0.8, g: -0.4 });
    actor.char.setVisible(false);
    if (!ghost) {
      ghost = makeGhost();
      ghost.bornT = T;
      ghost.place(c[0], 0, 0, 1);
    }
    api.setNight(true);
  };
  api.revive = function () {
    if (ghost) { ghost.dispose(); ghost = null; }
    api.setNight(false);
    api.setPoops(0);
  };

  api.isBusy = () => busy;

  /* ============ main loop ============ */
  let lastNow = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min((now - lastNow) / 1000, 0.05); lastNow = now;
    T += dt;

    for (const m of MATS) {
      if (m.uniforms && m.uniforms.uTime) m.uniforms.uTime.value = T;
    }
    // 昼夜
    DAY.value += (nightWant - DAY.value) * Math.min(dt * 1.5, 1);
    if (moonSprite) moonSprite.material.uniforms.uA.value = 1 - DAY.value;
    if (api._motes) api._motes.mat.opacity = 0.15 + DAY.value * 0.4;

    // タイマー/トゥイーン
    for (let i = timers.length - 1; i >= 0; i--) {
      if (T >= timers[i].t) { const f = timers[i].fn; timers.splice(i, 1); f(); }
    }
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      const u = clamp((T - tw.t0) / tw.dur, 0, 1);
      tw.apply(u);
      if (u >= 1) { tweens.splice(i, 1); if (tw.done) tw.done(); }
    }

    if (actor) actor.update(T, dt, env);
    if (opponent) opponent.update(T, dt, { sleeping: false, sick: false });
    if (ghost) { ghost.update(T, dt); }

    // エモート
    if (actor && api._alert && !env.sleeping) {
      emoteAlert.visible = true;
      const h = actor.headPos();
      emoteAlert.position.set(h[0], h[1] + 0.25 + Math.abs(Math.sin(T * 4)) * 0.12, h[2]);
    } else emoteAlert.visible = false;
    if (actor && env.sick && !env.sleeping) {
      emoteSick.visible = true;
      const h = actor.headPos();
      emoteSick.position.set(h[0] + Math.cos(T * 2.4) * 0.35, h[1] + 0.1, h[2] + Math.sin(T * 2.4) * 0.2);
    } else emoteSick.visible = false;
    if (actor && env.hungry && !env.sleeping && !busy) {
      hungryTimer -= dt;
      if (hungryTimer <= 0) {
        hungryTimer = 4.5;
        const h = actor.headPos();
        burst([h[0] + 0.3, h[1] + 0.1, h[2]], '🍖', 1, { size: 0.2, vy: 0.35, g: 0, speed: 0.05, life: 1.6 });
        burst([h[0] + 0.15, h[1] - 0.05, h[2]], '💭', 1, { size: 0.13, vy: 0.3, g: 0, speed: 0.05, life: 1.2 });
      }
    }
    if (env.sleeping && actor) {
      zzzTimer -= dt;
      if (zzzTimer <= 0) {
        zzzTimer = 1.1;
        const h = actor.headPos();
        burst([h[0] + 0.25, h[1], h[2]], '💤', 1, { size: 0.24, vy: 0.5, g: 0.15, speed: 0.15, life: 1.8 });
      }
    }

    updParticles(dt);
    // 塵
    const mo = api._motes;
    for (let j = 0; j < mo.n; j++) {
      mo.pos[j * 3 + 1] += dt * 0.06;
      if (mo.pos[j * 3 + 1] > 3.4) mo.pos[j * 3 + 1] = 0.2;
    }
    mo.pts.geometry.attributes.position.needsUpdate = true;

    // カメラ
    cam.shake = Math.max(0, cam.shake - dt);
    const az = cam.dragAz + Math.sin(T * 0.13) * 0.05;
    const el = cam.el + cam.dragEl;
    cam.dist = lerp(cam.dist, cam.wantDist, Math.min(dt * 4, 1));
    const shx = cam.shake > 0 ? (Math.random() - 0.5) * cam.shake * 0.3 : 0;
    const shy = cam.shake > 0 ? (Math.random() - 0.5) * cam.shake * 0.3 : 0;
    camera.position.set(
      cam.tgt.x + Math.sin(az) * Math.cos(el) * cam.dist + shx,
      cam.tgt.y + Math.sin(el) * cam.dist + shy,
      cam.tgt.z + Math.cos(az) * Math.cos(el) * cam.dist
    );
    camera.lookAt(cam.tgt);
    renderer.render(scene, camera);
  }

  return api;
})();
