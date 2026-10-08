/** All CSS for the HUD, touch controls and menus. Injected once from code (no stylesheets, no web fonts). */

const TOKENS = /* css */ `
:root{
  --gl-gold:#d8b66a; --gl-gold-hi:#f6e3a8; --gl-gold-dim:#8d7640; --gl-silver:#e3e9e5; --gl-leaf:#9fcb8b; --gl-leaf-deep:#4c7b47;
  --gl-ink:#060807; --gl-panel:rgba(8,11,9,.78); --gl-line:rgba(216,182,106,.42); --gl-line-soft:rgba(216,182,106,.2);
  --gl-text:#ece6d3; --gl-dim:#aaa58e; --gl-blood:#c4513f; --gl-axe:#dc8f52; --gl-focus:#a5d8ff;
  --gl-font:'Cormorant Garamond','Cormorant','EB Garamond','Palatino Linotype','Book Antiqua',Palatino,'URW Palladio L','Iowan Old Style',Georgia,'Liberation Serif','Times New Roman',serif;
}
.gl-hud,.gl-menus,.gl-touch{
  --pt:max(env(safe-area-inset-top,0px),16px); --pr:max(env(safe-area-inset-right,0px),20px);
  --pb:max(env(safe-area-inset-bottom,0px),16px); --pl:max(env(safe-area-inset-left,0px),20px);
  font-family:var(--gl-font); color:var(--gl-text); -webkit-user-select:none; user-select:none;
  -webkit-tap-highlight-color:transparent;
}
.gl-hud *,.gl-menus *,.gl-touch *{box-sizing:border-box}
.gl-ic{width:1em;height:1em;display:block;overflow:visible}
`;

const HUD = /* css */ `
.gl-hud{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:10;text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 12px rgba(0,0,0,.6)}
.gl-hud .gl-g{transition:opacity .4s ease,transform .4s ease}
.gl-hud.hidden .gl-g{opacity:0!important}
.gl-hud svg{overflow:visible}

/* vitals */
.gl-vitals{position:absolute;left:var(--pl);bottom:var(--pb);display:flex;flex-direction:column;gap:8px;width:clamp(230px,27vw,380px)}
.gl-bar-row{display:flex;align-items:center;gap:9px}
.gl-bar-ic{width:22px;height:22px;flex:none;color:var(--gl-leaf);filter:drop-shadow(0 1px 2px #000)}
.gl-bar-row.focus .gl-bar-ic{width:22px;height:22px;color:var(--gl-focus)}
.gl-bar{display:block;flex:1;min-width:0;height:auto;filter:drop-shadow(0 1px 3px rgba(0,0,0,.85))}
.gl-bar.small{width:76%;flex:none}
.gl-bar .track{fill:rgba(6,9,8,.62)}
.gl-bar .frame{fill:none;stroke:var(--gl-gold);stroke-width:1.1;opacity:.85}
.gl-bar .veins{stroke:#fff;stroke-width:.8;opacity:.16;fill:none}
.gl-bar .lag{fill:rgba(246,227,168,.55)}
.gl-vitals.low .gl-bar.hp{animation:gl-lowpulse 1s ease-in-out infinite}
.gl-bar-row.focus.active .gl-bar{filter:drop-shadow(0 0 7px rgba(165,216,255,.85))}
.gl-bar-row.focus.active .gl-bar-ic{filter:drop-shadow(0 0 6px rgba(165,216,255,.95));animation:gl-spinpulse 1.6s ease-in-out infinite}
.gl-bar-row.focus.ready .frame{stroke:var(--gl-focus)}
@keyframes gl-lowpulse{50%{filter:drop-shadow(0 0 9px rgba(210,60,40,.9))}}
@keyframes gl-spinpulse{50%{transform:scale(1.18)}}

/* arrow types */
.gl-arrows{position:absolute;right:var(--pr);bottom:var(--pb);display:flex;gap:12px;align-items:flex-end}
.gl-aslot{position:relative;width:50px;height:50px;border-radius:50%;border:1px solid rgba(216,182,106,.38);background:rgba(6,9,8,.55);color:var(--gl-dim);display:flex;align-items:center;justify-content:center;transition:all .22s ease;filter:drop-shadow(0 1px 3px rgba(0,0,0,.8))}
.gl-aslot .gl-ic{width:30px;height:30px}
.gl-aslot.locked{display:none}
.gl-aslot.sel{width:62px;height:62px;color:var(--gl-gold-hi);border-color:var(--gl-gold);background:rgba(20,17,8,.7);box-shadow:0 0 0 3px rgba(216,182,106,.1),0 0 18px rgba(216,182,106,.35)}
.gl-aslot.sel .gl-ic{width:38px;height:38px}
.gl-aslot .k{position:absolute;bottom:-9px;left:50%;transform:translateX(-50%);font-size:11px;line-height:1;padding:2px 5px;border:1px solid var(--gl-line);background:rgba(6,9,8,.86);color:var(--gl-dim);border-radius:3px;letter-spacing:.04em}
.gl-aname{position:absolute;right:0;bottom:calc(100% + 12px);font-size:11.5px;letter-spacing:.34em;text-transform:uppercase;color:var(--gl-gold-hi);white-space:nowrap}
.gl-dev-gamepad .gl-aslot .k,.gl-dev-touch .gl-aslot .k{display:none}
.gl-padhint{display:none;align-self:center}
.gl-dev-gamepad .gl-padhint{display:block}

/* crosshair */
.gl-cross{position:absolute;left:50%;top:50%;width:120px;height:120px;margin:-60px 0 0 -60px;transition:opacity .2s}
.gl-cross.off{opacity:0}
.gl-cross svg{width:100%;height:100%}
.gl-cross .tk-sh{stroke:rgba(0,0,0,.6);stroke-width:3.2;stroke-linecap:round;fill:none}
.gl-cross .tk{stroke:rgba(247,240,220,.95);stroke-width:1.3;stroke-linecap:round;fill:none}
.gl-cross .ticks{transition:transform .24s cubic-bezier(.2,.8,.2,1)}
.gl-cross.aim .ticks{transform:scale(.58)}
.gl-cross .dot{fill:rgba(247,240,220,.95);stroke:rgba(0,0,0,.55);stroke-width:.8}
.gl-cross .ring-w{transition:transform .24s cubic-bezier(.2,.8,.2,1)}
.gl-cross.aim .ring-w{transform:scale(.8)}
.gl-cross .ring-track{fill:none;stroke:rgba(0,0,0,.35);stroke-width:3.6;opacity:0;transition:opacity .2s}
.gl-cross .ring{fill:none;stroke:var(--gl-gold-hi);stroke-width:2;stroke-linecap:round;opacity:0;transition:opacity .15s;filter:drop-shadow(0 0 3px rgba(246,227,168,.55))}
.gl-cross.charging .ring,.gl-cross.charging .ring-track{opacity:1}
.gl-cross.aim .ring-track{opacity:.55}
.gl-cross.full .ring{stroke:#fff6d0;stroke-width:2.6;filter:drop-shadow(0 0 7px rgba(255,235,160,.95))}
.gl-hm{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none}
.gl-hm svg{position:absolute;left:-30px;top:-30px;width:60px;height:60px;opacity:0}
.gl-hm path{fill:none;stroke-linecap:round;stroke-width:2.6;stroke:#fff}
.gl-hm.head path{stroke:var(--gl-gold-hi);stroke-width:3.2}
.gl-hm.kill path{stroke:#ff6a55;stroke-width:3.4}
.gl-hm.armor path{stroke:#9aa7b4;stroke-width:2.4}

/* damage direction */
.gl-dmg{position:absolute;inset:0;overflow:hidden}
.gl-dmgw{position:absolute;left:50%;top:50%;width:76vmin;height:76vmin;margin:-38vmin 0 0 -38vmin;opacity:0}
.gl-dmgw svg{width:100%;height:100%;overflow:visible;-webkit-mask-image:linear-gradient(90deg,transparent 28%,#000 50%,transparent 72%);mask-image:linear-gradient(90deg,transparent 28%,#000 50%,transparent 72%)}
.gl-dmgw circle{fill:none;stroke-linecap:round}
.gl-dmgw .a1{stroke:rgba(225,48,34,.95);stroke-width:3.2}
.gl-dmgw .a2{stroke:rgba(200,30,20,.55);stroke-width:11;filter:blur(3px)}
.gl-dmgv{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(180,25,18,.5) 100%)}

/* top left: objective */
.gl-obj{position:absolute;left:var(--pl);top:calc(var(--pt) + 10px);max-width:min(440px,44vw);transition:opacity .4s;padding:8px 40px 9px 12px;margin:-8px 0 0 -12px;background:linear-gradient(90deg,rgba(4,6,5,.6),rgba(4,6,5,.42) 70%,rgba(4,6,5,0))}
.gl-obj.none{opacity:0}
.gl-obj .hd{display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.38em;text-transform:uppercase;color:var(--gl-gold-hi);margin-bottom:5px}
.gl-obj .hd .gl-ic{width:11px;height:11px}
.gl-obj .hd::after{content:"";flex:1;max-width:90px;height:1px;background:linear-gradient(90deg,var(--gl-gold),rgba(216,182,106,0))}
.gl-obj .tx{font-size:21px;line-height:1.22;color:var(--gl-text);letter-spacing:.01em}

/* top right: rivalry */
.gl-riv{position:absolute;right:var(--pr);top:calc(var(--pt) + 14px);display:flex;align-items:center;gap:15px;padding:9px 6px 9px 30px;background:linear-gradient(270deg,rgba(6,9,8,.72) 70%,rgba(6,9,8,0));border-right:1px solid var(--gl-gold-dim);transition:opacity .4s,transform .4s}
.gl-riv.none{opacity:0;transform:translateX(14px)}
.gl-riv .side{display:flex;flex-direction:column;align-items:center;min-width:58px}
.gl-riv .row{display:flex;align-items:center;gap:7px}
.gl-riv .row .gl-ic{width:20px;height:20px}
.gl-riv .you .gl-ic{color:var(--gl-leaf)}
.gl-riv .him .gl-ic{color:var(--gl-axe)}
.gl-riv .num{font-size:35px;line-height:1;font-variant-numeric:lining-nums tabular-nums;font-weight:600;color:var(--gl-silver);display:inline-block}
.gl-riv .lead .num{color:var(--gl-gold-hi)}
.gl-riv .who{margin-top:3px;font-size:10px;letter-spacing:.34em;text-transform:uppercase;color:#d9d3bb;padding-left:.34em}
.gl-riv .vs{width:1px;height:42px;background:linear-gradient(180deg,rgba(141,118,64,0),var(--gl-gold-dim),rgba(141,118,64,0))}

/* boss */
.gl-boss{position:absolute;left:50%;bottom:calc(var(--pb) + 22px);width:min(520px,44vw);transform:translateX(-50%);text-align:center;transition:opacity .5s,transform .5s}
.gl-boss.none{opacity:0;transform:translateX(-50%) translateY(10px)}
.gl-boss .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:15px;letter-spacing:.55em;text-transform:uppercase;color:var(--gl-gold-hi);margin-bottom:6px;padding-left:.55em}
.gl-boss svg{display:block;width:100%;height:auto;filter:drop-shadow(0 1px 4px rgba(0,0,0,.9))}
.gl-boss .track{fill:rgba(6,9,8,.7)}
.gl-boss .frame{fill:none;stroke:var(--gl-gold);stroke-width:1.2}
.gl-boss .lag{fill:rgba(246,227,168,.6)}

/* centre top column: progress + toasts */
.gl-topc{position:absolute;left:50%;top:calc(var(--pt) + 6px);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;width:min(560px,70vw)}
.gl-prog{width:min(360px,100%);text-align:center;transition:opacity .3s}
.gl-prog.none{display:none}
.gl-prog .lb{font-size:12.5px;letter-spacing:.4em;text-transform:uppercase;color:#f4f1e4;padding:3px 0 3px .4em;margin-bottom:5px;background:linear-gradient(90deg,rgba(4,6,5,0),rgba(4,6,5,.6) 20%,rgba(4,6,5,.6) 80%,rgba(4,6,5,0))}
.gl-prog .tr{position:relative;height:5px;background:rgba(6,9,8,.65);border:1px solid var(--gl-line)}
.gl-prog .fl{position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:0 50%;background:linear-gradient(90deg,var(--gl-gold-dim),var(--gl-gold-hi))}
.gl-toast{display:flex;align-items:center;gap:11px;padding:9px 34px 9px 28px;font-size:15px;letter-spacing:.2em;text-transform:uppercase;color:var(--gl-gold-hi);background:linear-gradient(90deg,rgba(6,9,8,0),rgba(6,9,8,.78) 22%,rgba(6,9,8,.78) 78%,rgba(6,9,8,0));position:relative;white-space:nowrap}
.gl-toast::before,.gl-toast::after{content:"";position:absolute;left:8%;right:8%;height:1px;background:linear-gradient(90deg,rgba(216,182,106,0),rgba(216,182,106,.8),rgba(216,182,106,0))}
.gl-toast::before{top:0}.gl-toast::after{bottom:0}
.gl-toast .gl-ic{width:18px;height:18px;flex:none}
.gl-toast.info{color:var(--gl-silver)}
.gl-toast.reward{color:#ffe9a0}
.gl-toast.warning{color:#ff9d86}

/* subtitles + prompt */
.gl-sub{position:absolute;left:50%;bottom:calc(var(--pb) + 13vh);transform:translateX(-50%);width:min(780px,calc(100vw - var(--pl) - var(--pr) - var(--sub-gutter,0px)));text-align:center;padding:12px 34px 14px;background:linear-gradient(90deg,rgba(4,6,5,0),rgba(4,6,5,.66) 14%,rgba(4,6,5,.66) 86%,rgba(4,6,5,0));opacity:0;transition:opacity .28s}
.gl-sub.on{opacity:1}
.gl-sub .sp{font-size:13px;letter-spacing:.42em;text-transform:uppercase;margin-bottom:3px;padding-left:.42em;font-weight:700}
.gl-sub .tx{font-size:clamp(18px,2.1vw,23px);line-height:1.28;color:#f1ead6}
.gl-prompt{position:absolute;left:50%;top:64%;transform:translate(-50%,0);display:flex;align-items:center;gap:12px;padding:8px 20px 8px 12px;font-size:19px;letter-spacing:.06em;color:var(--gl-text);background:linear-gradient(90deg,rgba(4,6,5,0),rgba(4,6,5,.7) 20%,rgba(4,6,5,.7) 80%,rgba(4,6,5,0));opacity:0;transition:opacity .25s}
.gl-prompt.on{opacity:1}
.gl-fps{position:absolute;right:var(--pr);top:4px;font:11px/1 ui-monospace,Menlo,Consolas,monospace;color:rgba(236,230,211,.7);display:none}
.gl-fps.on{display:block}

/* focus marks */
.gl-marks{position:absolute;inset:0}
.gl-mark{position:absolute;left:0;top:0;width:38px;height:38px;margin:-19px 0 0 -19px;color:var(--gl-focus);will-change:transform;display:none}
.gl-mark svg{width:100%;height:100%;filter:drop-shadow(0 0 4px rgba(120,190,255,.8))}
.gl-mark .ou{transform-origin:16px 16px;animation:gl-spin 6s linear infinite}
.gl-mark .in{fill:rgba(165,216,255,.12);transition:fill .15s}
.gl-mark.locked{color:var(--gl-gold-hi)}
.gl-mark.locked .in{fill:rgba(246,227,168,.7)}
.gl-mark.locked svg{filter:drop-shadow(0 0 6px rgba(255,214,120,.95))}
.gl-mark:not(.locked){opacity:.7}
@keyframes gl-spin{to{transform:rotate(360deg)}}

/* title card */
.gl-tc{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.5) 32%,rgba(0,0,0,.5) 68%,rgba(0,0,0,0));padding:0 7vw}
.gl-tc .film{font-size:clamp(11px,1.4vw,15px);letter-spacing:.6em;text-transform:uppercase;color:var(--gl-gold);margin-bottom:14px;padding-left:.6em}
.gl-tc .ttl{font-size:clamp(30px,6.4vw,86px);line-height:1.05;letter-spacing:.17em;padding-left:.17em;text-transform:uppercase;font-weight:500;color:#f4ecd2;background:linear-gradient(180deg,#fff8de 10%,#e1bf75 60%,#a98748);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;text-shadow:none;filter:drop-shadow(0 2px 14px rgba(0,0,0,.8))}
.gl-tc .gl-orn{width:min(300px,56vw);height:14px;color:var(--gl-gold);margin:18px 0 16px}
.gl-tc .sub{font-size:clamp(15px,2vw,26px);font-style:italic;letter-spacing:.12em;color:var(--gl-silver)}

/* key / pad glyphs (shared with menus) */
.gl-key{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 7px;border:1px solid rgba(236,230,211,.55);border-bottom-width:3px;border-radius:5px;background:rgba(10,13,11,.85);color:var(--gl-text);font-family:var(--gl-font);font-size:14px;font-weight:700;letter-spacing:.03em;text-shadow:none;line-height:1;margin:0 2px}
.gl-pad{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;border-radius:50%;border:1.5px solid rgba(236,230,211,.6);background:rgba(10,13,11,.85);color:var(--gl-text);font:700 13px/1 var(--gl-font);text-shadow:none;margin:0 2px}
.gl-pad-a{color:#a5e08a;border-color:#a5e08a}.gl-pad-b{color:#ff8e7a;border-color:#ff8e7a}.gl-pad-x{color:#8fc3ff;border-color:#8fc3ff}.gl-pad-y{color:#ffdc7a;border-color:#ffdc7a}
.gl-pad-wide{border-radius:7px;padding:0 8px;min-width:34px;font-size:12px;letter-spacing:.05em}
.gl-tglyph{display:inline-flex;width:30px;height:30px;border-radius:50%;border:1.5px solid var(--gl-gold);align-items:center;justify-content:center;background:rgba(10,13,11,.75);color:var(--gl-gold-hi)}
.gl-tglyph .gl-ic{width:17px;height:17px}
.gl-mouse{display:inline-block;width:20px;height:20px;vertical-align:middle;color:var(--gl-text);margin:0 3px}
.gl-sep{opacity:.55;margin:0 4px;font-size:13px}
.gl-orn{display:block}

/* phone adjustments */
@media (max-height:480px){
  .gl-obj .tx{font-size:17px}
  .gl-riv .num{font-size:28px}
}
.gl-dev-touch .gl-arrows{display:none}
.gl-dev-touch .gl-vitals{bottom:auto;top:calc(var(--pt) - 2px);width:min(210px,32vw)}
.gl-dev-touch .gl-obj{top:calc(var(--pt) + 60px);max-width:min(236px,28vw)}
.gl-dev-touch .gl-obj .tx{font-size:16px}
.gl-dev-touch .gl-riv{right:calc(var(--pr) + 66px);top:calc(var(--pt) - 6px);gap:10px;padding:6px 4px 6px 16px}
.gl-dev-touch .gl-riv .num{font-size:26px}
.gl-dev-touch .gl-riv .row .gl-ic{width:16px;height:16px}
.gl-dev-touch .gl-riv .side{min-width:48px}
.gl-dev-touch .gl-riv .vs{height:32px}
.gl-dev-touch .gl-boss{bottom:auto;left:calc(50% - 20px);top:calc(var(--pt) + 4px);width:min(300px,34vw)}
.gl-dev-touch .gl-boss .nm{font-size:11.5px;letter-spacing:.3em}
.gl-dev-touch .gl-topc{left:calc(50% - 20px);top:calc(var(--pt) + 4px);width:min(300px,34vw)}
.gl-dev-touch .gl-boss:not(.none) + .gl-topc{top:calc(var(--pt) + 56px)}
.gl-dev-touch .gl-sub{left:calc(var(--pl) + 176px);right:calc(var(--pr) + 276px);bottom:calc(var(--pb) - 6px);transform:none;width:auto;padding:8px 14px 10px}
.gl-dev-touch .gl-sub .tx{font-size:16px}
.gl-dev-touch .gl-prompt{top:62%}
@media (orientation:portrait){
  .gl-dev-touch .gl-vitals{width:min(200px,50vw)}
  .gl-dev-touch .gl-riv{right:var(--pr);top:calc(var(--pt) + 62px);padding-left:12px;gap:8px}
  .gl-dev-touch .gl-riv .num{font-size:24px}
  .gl-dev-touch .gl-riv .side{min-width:44px}
  .gl-dev-touch .gl-obj{top:calc(var(--pt) + 62px);max-width:calc(100vw - 170px - var(--pl) - var(--pr))}
  .gl-dev-touch .gl-boss{left:50%;top:calc(var(--pt) + 150px);width:84vw}
  .gl-dev-touch .gl-topc{left:50%;top:calc(var(--pt) + 196px);width:90vw}
  .gl-dev-touch .gl-boss:not(.none) + .gl-topc{top:calc(var(--pt) + 226px)}
  .gl-dev-touch .gl-sub{left:50%;right:auto;transform:translateX(-50%);width:calc(100vw - var(--pl) - var(--pr));bottom:calc(var(--pb) + 316px)}
  .gl-dev-touch .gl-prompt{top:54%}
}
@media (max-width:640px){
  .gl-toast{font-size:13px;letter-spacing:.14em;padding:8px 22px}
}
`;

const TOUCH = /* css */ `
.gl-touch{position:absolute;inset:0;z-index:20;pointer-events:none;--s:64px;--L:96px;--g:10px;--p:max(env(safe-area-inset-right,0px),16px);--q:max(env(safe-area-inset-bottom,0px),18px);touch-action:none}
.gl-touch[hidden]{display:none}
.gl-touch.off{opacity:.0;pointer-events:none!important}
.gl-touch.off *{pointer-events:none!important}
.gl-t-zone{position:absolute;inset:0;pointer-events:auto;touch-action:none}
.gl-t-stick{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;transition:opacity .2s}
.gl-t-stick.idle{transform:none!important;left:calc(max(env(safe-area-inset-left,0px),16px) + 92px);top:calc(100% - var(--q) - 96px);opacity:.38}
.gl-t-ring{position:absolute;left:-56px;top:-56px;width:112px;height:112px;border-radius:50%;border:1.5px solid rgba(216,182,106,.55);background:radial-gradient(circle,rgba(216,182,106,.07),rgba(6,10,8,.22));box-shadow:0 0 0 1px rgba(0,0,0,.25),inset 0 0 18px rgba(0,0,0,.25)}
.gl-t-sprint{position:absolute;inset:-12px;border-radius:50%;border:1px dashed rgba(216,182,106,.28);transition:all .15s}
.gl-t-stick.sprint .gl-t-sprint{border-color:var(--gl-gold-hi);box-shadow:0 0 14px rgba(246,227,168,.55)}
.gl-t-knob{position:absolute;left:-24px;top:-24px;width:48px;height:48px;border-radius:50%;border:1.5px solid var(--gl-gold);background:radial-gradient(circle at 35% 30%,rgba(246,227,168,.5),rgba(120,98,50,.4));box-shadow:0 2px 8px rgba(0,0,0,.45)}

.gl-tbtn{position:absolute;pointer-events:auto;touch-action:none;width:var(--s);height:var(--s);border-radius:50%;padding:0;border:1.5px solid rgba(216,182,106,.62);background:radial-gradient(circle at 50% 35%,rgba(26,34,28,.5),rgba(6,10,8,.5));color:var(--gl-gold-hi);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:var(--gl-font);box-shadow:0 2px 10px rgba(0,0,0,.4),inset 0 0 12px rgba(0,0,0,.25);transition:transform .08s,background .12s,box-shadow .12s;outline:none;-webkit-tap-highlight-color:transparent;cursor:pointer}
.gl-tbtn .gl-ic{width:calc(var(--s) * .46);height:calc(var(--s) * .46);filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))}
.gl-tbtn[hidden]{display:none}
.gl-tbtn.down,.gl-tbtn.on{transform:scale(.92);background:radial-gradient(circle at 50% 40%,rgba(246,227,168,.45),rgba(120,98,50,.4));box-shadow:0 0 18px rgba(246,227,168,.45),inset 0 0 10px rgba(255,255,255,.12)}
.gl-t-draw{width:var(--L);height:var(--L);right:var(--p);bottom:var(--q);border-width:2px;border-color:var(--gl-gold)}
.gl-t-draw .gl-ic{width:calc(var(--L) * .42);height:calc(var(--L) * .42)}
.gl-t-cap{font-size:11px;letter-spacing:.3em;padding-left:.3em;color:var(--gl-gold);margin-top:-1px}
.gl-t-aim{right:calc(var(--p) + var(--L) + var(--g));bottom:var(--q)}
.gl-t-melee{right:calc(var(--p) + var(--L) + var(--g) * 2 + var(--s));bottom:var(--q)}
.gl-t-jump{right:calc(var(--p) + (var(--L) - var(--s)) / 2);bottom:calc(var(--q) + var(--L) + var(--g))}
.gl-t-dash{right:calc(var(--p) + var(--L) + var(--g));bottom:calc(var(--q) + var(--s) + var(--g))}
.gl-t-focus{right:calc(var(--p) + var(--L) + var(--g) * 2 + var(--s));bottom:calc(var(--q) + var(--s) + var(--g))}
.gl-t-next{right:calc(var(--p) + var(--L) + var(--g) * 2 + var(--s));bottom:calc(var(--q) + (var(--s) + var(--g)) * 2);width:56px;height:56px}
.gl-t-next .gl-ic{width:28px;height:28px}
.gl-t-pause{right:var(--p);top:max(env(safe-area-inset-top,0px),12px);width:56px;height:56px;border-color:rgba(216,182,106,.4);background:rgba(6,10,8,.38)}
.gl-t-pause .gl-ic{width:24px;height:24px}
.gl-t-interact{border-radius:30px;width:auto;min-width:var(--s);height:58px;flex-direction:row;gap:9px;padding:0 20px 0 16px;right:calc(var(--p) + var(--L) + var(--g) * 3 + var(--s) * 2);bottom:calc(var(--q) + 92px);border-color:var(--gl-gold-hi);animation:gl-bob 1.8s ease-in-out infinite}
.gl-t-interact .gl-ic{width:26px;height:26px}
.gl-t-label{font-size:16px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}
@keyframes gl-bob{50%{box-shadow:0 0 18px rgba(246,227,168,.5),0 2px 10px rgba(0,0,0,.4)}}
@media (orientation:portrait){
  .gl-touch{--s:58px;--L:88px;--g:8px;--q:max(env(safe-area-inset-bottom,0px),26px)}
  .gl-t-interact{right:var(--p);bottom:calc(var(--q) + (var(--s) + var(--g)) * 2 + var(--L) + var(--g))}
  .gl-t-stick.idle{top:calc(100% - var(--q) - 112px)}
}
@media (max-height:420px) and (orientation:landscape){
  .gl-touch{--s:58px;--L:88px;--g:8px;--q:max(env(safe-area-inset-bottom,0px),12px)}
  .gl-t-next{width:58px;height:58px}
}
`;

const MENUS = /* css */ `
.gl-menus{position:absolute;inset:0;z-index:50;pointer-events:none;overflow:hidden}
.gl-screen{position:absolute;inset:0;pointer-events:auto;display:flex;align-items:center;justify-content:center;padding:var(--pt) var(--pr) var(--pb) var(--pl);animation:gl-in .42s cubic-bezier(.2,.7,.2,1) both;overflow:hidden}
.gl-screen.leaving{animation:gl-out .18s ease both;pointer-events:none}
.gl-screen::before{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(ellipse 85% 75% at 50% 48%,rgba(3,6,5,.5),rgba(2,4,3,.86) 100%)}
.gl-screen.pause::before{background:rgba(2,4,3,.6)}
.gl-screen.title::before{background:radial-gradient(ellipse 70% 60% at 50% 46%,rgba(2,4,3,.2),rgba(2,4,3,.8) 100%),linear-gradient(180deg,rgba(2,4,3,.6),rgba(2,4,3,.05) 34%,rgba(2,4,3,.05) 55%,rgba(2,4,3,.82))}
.gl-screen.defeat::before{background:radial-gradient(ellipse 80% 70% at 50% 50%,rgba(40,3,2,.55),rgba(8,1,1,.92) 100%)}
.gl-screen.credits::before{background:rgba(2,4,3,.9)}
@keyframes gl-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes gl-out{to{opacity:0}}

.gl-panel{position:relative;max-height:100%;max-width:100%;display:flex;flex-direction:column;background:linear-gradient(180deg,rgba(15,20,17,.84),rgba(6,9,8,.9));border:1px solid var(--gl-line);box-shadow:0 24px 70px rgba(0,0,0,.65),inset 0 0 70px rgba(0,0,0,.45);padding:26px 34px 22px;backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}
.gl-panel::before,.gl-panel::after{content:"";position:absolute;left:-5px;right:-5px;height:20px;pointer-events:none;background:
 linear-gradient(var(--gl-gold),var(--gl-gold)) 0 0/16px 2px no-repeat,linear-gradient(var(--gl-gold),var(--gl-gold)) 0 0/2px 16px no-repeat,
 linear-gradient(var(--gl-gold),var(--gl-gold)) 100% 0/16px 2px no-repeat,linear-gradient(var(--gl-gold),var(--gl-gold)) 100% 0/2px 16px no-repeat}
.gl-panel::before{top:-5px}
.gl-panel::after{bottom:-5px;transform:scaleY(-1)}
.gl-panel > :not(.gl-scroll){flex:none}
.gl-panel > .gl-scroll{flex:1 1 auto}
.gl-h1{margin:0;text-align:center;font-weight:500;font-size:clamp(22px,3vw,34px);letter-spacing:.34em;padding-left:.34em;text-transform:uppercase;color:var(--gl-gold-hi);text-shadow:0 2px 12px rgba(0,0,0,.7);line-height:1.15}
.gl-h2{margin:0;font-weight:600;font-size:13px;letter-spacing:.34em;text-transform:uppercase;color:var(--gl-gold)}
.gl-lede{text-align:center;color:var(--gl-dim);font-style:italic;font-size:17px;margin:6px 0 0;letter-spacing:.03em}
.gl-panel > .gl-orn{width:min(300px,70%);height:14px;margin:10px auto 16px;color:var(--gl-gold)}
.gl-scroll{overflow-y:auto;overflow-x:hidden;min-height:0;scrollbar-width:thin;scrollbar-color:var(--gl-gold-dim) transparent;padding:8px 12px 8px 8px;margin:-8px -12px -8px -8px;-webkit-overflow-scrolling:touch}
.gl-scroll::-webkit-scrollbar{width:6px}
.gl-scroll::-webkit-scrollbar-thumb{background:var(--gl-gold-dim);border-radius:3px}

/* buttons */
.gl-btn{position:relative;font:600 15px/1.1 var(--gl-font);letter-spacing:.24em;padding:13px 24px 13px calc(24px + .24em);text-transform:uppercase;color:var(--gl-text);background:rgba(10,14,12,.35);border:1px solid var(--gl-line);cursor:pointer;outline:none;transition:background .18s,border-color .18s,color .18s,box-shadow .18s,transform .12s;display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:46px;text-align:center}
.gl-btn:hover,.gl-btn:focus-visible,.gl-btn.focus{background:rgba(216,182,106,.14);border-color:var(--gl-gold-hi);color:#fff6d8;box-shadow:0 0 18px rgba(216,182,106,.2),inset 0 0 14px rgba(216,182,106,.08)}
.gl-btn:active{transform:scale(.985)}
.gl-btn.primary{background:linear-gradient(180deg,rgba(226,194,120,.95),rgba(166,130,64,.95));color:#1a1306;border-color:#f3dd9c;text-shadow:0 1px 0 rgba(255,255,255,.25)}
.gl-btn.primary:hover,.gl-btn.primary:focus-visible{background:linear-gradient(180deg,#f8e3a4,#c9a255);color:#120d03;box-shadow:0 0 24px rgba(246,227,168,.5)}
.gl-btn.danger:hover,.gl-btn.danger:focus-visible{border-color:#ff9a86;background:rgba(196,81,63,.18)}
.gl-btn.confirm{border-color:#ff9a86;color:#ffd6cc;background:rgba(196,81,63,.2)}
.gl-btn[disabled],.gl-btn.locked{opacity:.4;cursor:default}
.gl-btn .gl-ic{width:18px;height:18px}
.gl-btn.small{min-height:36px;padding:8px 14px 8px calc(14px + .2em);font-size:12.5px;letter-spacing:.2em}
.gl-btn.wide{width:100%}
.gl-screen.has-hints{padding-bottom:calc(var(--pb) + 30px)}
.gl-back{position:absolute;left:16px;top:14px;padding:8px 16px 8px calc(16px + .2em);min-height:40px;font-size:13px}
.gl-actions{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:18px}
.gl-actions.col{flex-direction:column;align-items:stretch;min-width:min(340px,76vw)}
.gl-shake{animation:gl-shake .32s}
@keyframes gl-shake{20%{transform:translateX(-5px)}40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}

/* hint bar */
.gl-hints{position:absolute;left:0;right:0;bottom:max(env(safe-area-inset-bottom,0px),12px);display:flex;justify-content:center;align-items:center;gap:6px;font-size:14px;letter-spacing:.1em;color:var(--gl-dim);pointer-events:none}
.gl-hints em{font-style:normal;margin:0 14px 0 4px;text-transform:uppercase;letter-spacing:.2em;font-size:12px}
.gl-hints:empty{display:none}

/* title */
.gl-title-wrap{display:flex;flex-direction:column;align-items:center;text-align:center;max-height:100%;width:100%}
.gl-emblem{width:clamp(70px,13vh,118px);height:auto;color:var(--gl-gold);filter:drop-shadow(0 0 16px rgba(216,182,106,.35));margin-bottom:6px;animation:gl-float 6s ease-in-out infinite}
@keyframes gl-float{50%{transform:translateY(-4px)}}
.gl-logo{margin:0;font-weight:500;font-size:clamp(46px,min(10vw,17vh),132px);line-height:1;letter-spacing:.26em;padding-left:.26em;text-transform:uppercase;background:linear-gradient(180deg,#fffbe9 6%,#f0d48d 40%,#b5914c 78%,#8a6c33);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 3px 18px rgba(0,0,0,.8)) drop-shadow(0 0 28px rgba(216,182,106,.18))}
.gl-tag{font-size:clamp(14px,2vw,22px);font-style:italic;letter-spacing:.26em;color:var(--gl-silver);margin-top:8px;padding-left:.26em;text-shadow:0 2px 10px rgba(0,0,0,.9)}
.gl-title-wrap .gl-orn{width:min(380px,70vw);height:16px;color:var(--gl-gold);margin:14px 0 12px}
.gl-tmenu{display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:6px}
.gl-tm{position:relative;font:500 clamp(17px,2.5vh,22px)/1 var(--gl-font);letter-spacing:.32em;padding:clamp(7px,1.5vh,11px) 44px clamp(7px,1.5vh,11px) calc(44px + .32em);text-transform:uppercase;color:var(--gl-text);background:none;border:0;cursor:pointer;outline:none;transition:color .2s,letter-spacing .25s,text-shadow .2s;text-shadow:0 2px 10px rgba(0,0,0,.9);min-width:min(320px,80vw)}
.gl-tm::before,.gl-tm::after{content:"";position:absolute;top:50%;width:0;height:1px;background:linear-gradient(90deg,rgba(246,227,168,0),var(--gl-gold-hi));transition:width .3s}
.gl-tm::before{left:6px}
.gl-tm::after{right:6px;transform:scaleX(-1)}
.gl-tm:hover,.gl-tm:focus-visible,.gl-tm.focus{color:var(--gl-gold-hi);text-shadow:0 0 18px rgba(246,227,168,.5),0 2px 10px rgba(0,0,0,.9)}
.gl-tm:hover::before,.gl-tm:focus-visible::before,.gl-tm.focus::before,.gl-tm:hover::after,.gl-tm:focus-visible::after,.gl-tm.focus::after{width:28px}
.gl-tm small{display:block;margin-top:5px;font-size:12px;letter-spacing:.2em;color:var(--gl-dim);font-style:italic;text-transform:none}
.gl-foot{position:absolute;left:0;right:0;bottom:calc(max(env(safe-area-inset-bottom,0px),12px) + 30px);text-align:center;font-size:12px;letter-spacing:.18em;color:rgba(170,165,142,.7)}

/* chapter select */
.gl-chapters{width:min(1180px,100%)}
.gl-chgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:16px;padding:6px 4px 10px}
.gl-ch{position:relative;display:flex;flex-direction:column;border:1px solid var(--gl-line);background:linear-gradient(180deg,rgba(18,24,20,.8),rgba(8,11,9,.86));transition:border-color .2s,box-shadow .2s,transform .2s;overflow:hidden;outline:none}
.gl-ch:focus-within,.gl-ch:hover{border-color:var(--gl-gold-hi);box-shadow:0 0 22px rgba(216,182,106,.2);transform:translateY(-2px)}
.gl-ch .ban{position:relative;height:74px;overflow:hidden;background:var(--ban,linear-gradient(135deg,#1c2a20,#0b100d))}
.gl-ch .ban::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 80% 120%,rgba(255,255,255,.14),transparent 60%),linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.55))}
.gl-ch .num{position:absolute;left:14px;bottom:-2px;font-size:62px;line-height:1;font-weight:500;color:rgba(246,227,168,.9);letter-spacing:.04em;text-shadow:0 2px 12px rgba(0,0,0,.7);font-variant-numeric:lining-nums}
.gl-ch .rank{position:absolute;right:12px;top:10px;width:42px;height:42px;border-radius:50%;border:1.5px solid var(--gl-gold);display:flex;align-items:center;justify-content:center;font-size:23px;font-weight:700;color:var(--gl-gold-hi);background:rgba(6,9,8,.7)}
.gl-ch .rank.none{border-color:rgba(216,182,106,.25);color:rgba(216,182,106,.35);font-size:17px}
.gl-ch .rank.S{color:#fff2b8;border-color:#fff2b8;box-shadow:0 0 14px rgba(255,236,150,.55)}
.gl-ch .bd{padding:12px 16px 4px;flex:1;display:flex;flex-direction:column}
.gl-ch .ti{font-size:21px;font-weight:600;letter-spacing:.08em;color:var(--gl-text);text-transform:uppercase;line-height:1.15}
.gl-ch .fm{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--gl-gold);margin:4px 0 7px}
.gl-ch .bl{font-size:15.5px;line-height:1.3;color:var(--gl-dim);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:8px}
.gl-ch .ft{padding:6px 14px 14px;display:flex;flex-wrap:wrap;gap:7px;align-items:center}
.gl-ch .ft .gl-btn.small{min-height:34px}
.gl-chip{font:600 12px/1 var(--gl-font);letter-spacing:.14em;padding:8px 11px;color:var(--gl-dim);background:rgba(10,14,12,.5);border:1px solid var(--gl-line-soft);cursor:pointer;outline:none;max-width:100%;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;text-transform:uppercase;transition:all .15s}
.gl-chip:hover,.gl-chip:focus-visible{color:#fff6d8;border-color:var(--gl-gold-hi);background:rgba(216,182,106,.14)}
.gl-ch.locked{filter:saturate(.35) brightness(.78)}
.gl-ch .lk{display:flex;align-items:center;gap:9px;padding:6px 16px 16px;color:var(--gl-dim);font-size:14px;font-style:italic}
.gl-ch .lk .gl-ic{width:20px;height:20px;color:var(--gl-gold-dim)}
.gl-ch .dev{position:absolute;left:12px;top:8px;font-size:10px;letter-spacing:.3em;padding:2px 6px;border:1px solid var(--gl-gold-dim);color:var(--gl-gold)}

/* upgrades */
.gl-upwrap{width:min(1020px,100%)}
.gl-points{display:flex;align-items:center;justify-content:center;gap:12px;margin:2px 0 14px;color:var(--gl-gold-hi);font-size:15px;letter-spacing:.3em;text-transform:uppercase}
.gl-points .gl-ic{width:24px;height:24px;color:var(--gl-gold)}
.gl-points b{font-size:34px;letter-spacing:.04em;font-weight:600;line-height:1;color:#fff3c8}
.gl-upgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,440px),1fr));gap:12px;padding:4px 4px 8px}
.gl-up{position:relative;display:grid;grid-template-columns:48px 1fr auto;gap:4px 16px;align-items:center;padding:13px 16px;border:1px solid var(--gl-line-soft);background:rgba(10,14,12,.5);transition:border-color .2s,background .2s}
.gl-up:focus-within,.gl-up:hover{border-color:var(--gl-gold);background:rgba(20,24,16,.6)}
.gl-up .ic{grid-row:1/3;width:48px;height:48px;border-radius:50%;border:1px solid var(--gl-line);display:flex;align-items:center;justify-content:center;color:var(--gl-gold-hi);background:rgba(6,9,8,.6)}
.gl-up .ic .gl-ic{width:26px;height:26px}
.gl-up .nm{font-size:18px;font-weight:600;letter-spacing:.12em;text-transform:uppercase}
.gl-up .ds{grid-column:2;font-size:15px;color:var(--gl-dim);line-height:1.25}
.gl-up .buy{grid-column:3;grid-row:1/3;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:96px}
.gl-up .cost{font-size:13px;letter-spacing:.2em;color:var(--gl-gold-hi);display:flex;align-items:center;gap:5px}
.gl-up .cost .gl-ic{width:14px;height:14px}
.gl-up .cost.max{color:var(--gl-leaf)}
.gl-pips{display:flex;gap:5px;margin-top:3px}
.gl-pip{width:11px;height:11px;transform:rotate(45deg);border:1px solid var(--gl-gold-dim);background:transparent}
.gl-pip.on{background:var(--gl-gold);border-color:var(--gl-gold-hi);box-shadow:0 0 8px rgba(216,182,106,.55)}
.gl-up .nmrow{display:flex;flex-direction:column}

/* settings */
.gl-setwrap{width:min(1080px,100%)}
.gl-setgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 46px}
.gl-set{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 18px;align-items:center;padding:10px 6px;border-bottom:1px solid rgba(216,182,106,.1)}
.gl-set:last-child{border-bottom:0}
.gl-set label{font-size:15px;letter-spacing:.2em;text-transform:uppercase;color:var(--gl-text)}
.gl-set.focus label,.gl-set:focus-within label{color:var(--gl-gold-hi)}
.gl-seg{display:inline-flex;border:1px solid var(--gl-line)}
.gl-seg button{font:600 13px/1 var(--gl-font);letter-spacing:.18em;padding:10px 14px 10px calc(14px + .18em);color:var(--gl-dim);background:transparent;border:0;border-right:1px solid var(--gl-line-soft);cursor:pointer;text-transform:uppercase;outline:none;min-height:38px;transition:all .15s}
.gl-seg button:last-child{border-right:0}
.gl-seg button:hover,.gl-seg button:focus-visible{color:#fff6d8;background:rgba(216,182,106,.14)}
.gl-seg button.on{color:#1a1306;background:linear-gradient(180deg,#e8cd8a,#b48f48);font-weight:700}
.gl-slide{display:flex;align-items:center;gap:14px;min-width:min(260px,44vw)}
.gl-slide output{min-width:44px;text-align:right;font-size:15px;color:var(--gl-gold-hi);font-variant-numeric:tabular-nums lining-nums;letter-spacing:.05em}
.gl-slide input{-webkit-appearance:none;appearance:none;flex:1;height:26px;background:transparent;outline:none;cursor:pointer;margin:0}
.gl-slide input::-webkit-slider-runnable-track{height:2px;background:linear-gradient(90deg,var(--gl-gold) var(--v,50%),rgba(216,182,106,.25) var(--v,50%))}
.gl-slide input::-moz-range-track{height:2px;background:rgba(216,182,106,.25)}
.gl-slide input::-moz-range-progress{height:2px;background:var(--gl-gold)}
.gl-slide input::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-6px;transform:rotate(45deg);background:var(--gl-gold-hi);border:1px solid #2a2008;box-shadow:0 0 8px rgba(246,227,168,.5)}
.gl-slide input::-moz-range-thumb{width:12px;height:12px;border-radius:0;transform:rotate(45deg);background:var(--gl-gold-hi);border:1px solid #2a2008}
.gl-slide input:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 4px rgba(246,227,168,.28),0 0 12px rgba(246,227,168,.8)}
.gl-toggle{position:relative;width:54px;height:26px;border:1px solid var(--gl-line);background:rgba(6,9,8,.6);cursor:pointer;padding:0;outline:none;transition:all .2s}
.gl-toggle::after{content:"";position:absolute;left:4px;top:4px;width:16px;height:16px;transform:rotate(45deg) scale(.8);background:var(--gl-dim);transition:all .22s}
.gl-toggle[aria-checked=true]{background:rgba(216,182,106,.38);border-color:var(--gl-gold)}
.gl-toggle[aria-checked=true]::after{left:32px;background:var(--gl-gold-hi);box-shadow:0 0 10px rgba(246,227,168,.7)}
.gl-toggle:focus-visible,.gl-toggle:hover{border-color:var(--gl-gold-hi);box-shadow:0 0 12px rgba(216,182,106,.3)}

/* controls */
.gl-ctlwrap{width:min(1180px,100%)}
.gl-tabs{display:none;margin:0 auto 12px;width:fit-content}
.gl-ctlgrid{display:grid;grid-template-columns:1.1fr 1fr .9fr;gap:22px}
.gl-ctlcol h3{margin:0 0 8px;font-size:14px;letter-spacing:.34em;text-transform:uppercase;font-weight:600;color:var(--gl-gold);display:flex;align-items:center;gap:10px;padding-bottom:7px;border-bottom:1px solid var(--gl-line)}
.gl-ctlcol h3 .gl-ic{width:20px;height:20px}
.gl-bind{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,auto);gap:12px;align-items:center;padding:7px 2px;border-bottom:1px solid rgba(216,182,106,.08);font-size:16px}
.gl-bind .ac{color:var(--gl-text);letter-spacing:.04em}
.gl-bind .bd{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:1px;color:var(--gl-silver);font-size:14px;text-align:right}
.gl-bind .bd .gl-key,.gl-bind .bd .gl-pad{height:24px}

/* pause */
.gl-pausewrap{min-width:min(420px,92vw);align-items:center}
.gl-pausewrap .gl-actions{width:100%}
.gl-sub-ch{text-align:center;font-style:italic;color:var(--gl-dim);font-size:17px;letter-spacing:.06em;margin:4px 0 0}

/* loading */
.gl-loading{position:absolute;inset:0;z-index:70;pointer-events:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 45%,#0d1510,#030504 80%);text-align:center;padding:var(--pt) var(--pr) var(--pb) var(--pl);transition:opacity .45s}
.gl-loading.out{opacity:0;pointer-events:none}
.gl-loading .gl-emblem{width:clamp(70px,16vh,110px);animation:gl-spinslow 18s linear infinite;opacity:.85;margin-bottom:18px}
@keyframes gl-spinslow{to{transform:rotate(360deg)}}
.gl-loading .kk{font-size:12px;letter-spacing:.5em;color:var(--gl-gold);text-transform:uppercase;padding-left:.5em}
.gl-loading .nm{margin:10px 0 0;font-size:clamp(26px,5vw,52px);font-weight:500;letter-spacing:.2em;padding-left:.2em;text-transform:uppercase;color:#f4ecd2;line-height:1.15}
.gl-loading .gl-orn{width:min(340px,70vw);height:14px;color:var(--gl-gold);margin:16px 0}
.gl-loading .bar{position:relative;width:min(440px,76vw);height:3px;background:rgba(216,182,106,.18)}
.gl-loading .bar i{position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:0 50%;background:linear-gradient(90deg,var(--gl-gold-dim),var(--gl-gold-hi));transition:transform .25s ease-out}
.gl-loading .bar i::after{content:"";position:absolute;right:-4px;top:-3px;width:9px;height:9px;transform:rotate(45deg);background:var(--gl-gold-hi);box-shadow:0 0 10px rgba(246,227,168,.9)}
.gl-loading .pc{margin-top:12px;font-size:13px;letter-spacing:.3em;color:var(--gl-dim);font-variant-numeric:tabular-nums lining-nums}
.gl-loading .lore{margin-top:26px;max-width:min(560px,84vw);font-style:italic;font-size:clamp(16px,2vw,20px);line-height:1.4;color:var(--gl-silver);opacity:.85}

/* chapter complete */
.gl-donewrap{width:min(840px,100%)}
.gl-done-top{display:grid;grid-template-columns:1fr auto;gap:26px;align-items:center}
.gl-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:0 28px}
.gl-stat{display:flex;justify-content:space-between;align-items:baseline;padding:8px 2px;border-bottom:1px solid rgba(216,182,106,.12);font-size:16px}
.gl-stat span{letter-spacing:.2em;text-transform:uppercase;font-size:12.5px;color:var(--gl-dim)}
.gl-stat b{font-weight:600;font-size:22px;color:var(--gl-text);font-variant-numeric:tabular-nums lining-nums}
.gl-rankbox{display:flex;flex-direction:column;align-items:center;gap:8px}
.gl-rank{width:clamp(110px,20vh,150px);height:clamp(110px,20vh,150px);border-radius:50%;border:2px solid var(--gl-gold);display:flex;align-items:center;justify-content:center;font-size:clamp(64px,12vh,92px);font-weight:600;line-height:1;color:var(--gl-gold-hi);background:radial-gradient(circle,rgba(216,182,106,.16),rgba(6,9,8,.7) 70%);box-shadow:0 0 0 6px rgba(216,182,106,.08),0 0 40px rgba(216,182,106,.3);opacity:0;transform:scale(1.7)}
.gl-donewrap .gl-scroll{padding:36px 44px;margin:-36px -44px}
.gl-rank.show{animation:gl-stamp .7s cubic-bezier(.2,1.2,.3,1) both}
.gl-rank.S{color:#fff2b8;border-color:#fff2b8;box-shadow:0 0 0 6px rgba(255,242,184,.12),0 0 60px rgba(255,230,140,.6)}
.gl-rank.D,.gl-rank.C{color:#c9c2a8}
@keyframes gl-stamp{0%{opacity:0;transform:scale(1.8) rotate(-8deg)}60%{opacity:1;transform:scale(.94) rotate(1deg)}100%{opacity:1;transform:none}}
.gl-rankbox small{letter-spacing:.34em;font-size:11px;text-transform:uppercase;color:var(--gl-dim);padding-left:.34em}
.gl-reward{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px;font-size:17px;letter-spacing:.14em;color:var(--gl-gold-hi);text-transform:uppercase}
.gl-reward .gl-ic{width:24px;height:24px;color:var(--gl-gold)}
.gl-reward b{font-size:28px;letter-spacing:.04em;color:#fff3c8}
.gl-reward .tag{font-size:11px;letter-spacing:.3em;padding:3px 8px;border:1px solid var(--gl-gold);color:var(--gl-gold)}
.gl-rivres{margin-top:12px;display:flex;align-items:center;justify-content:center;gap:18px;padding:10px 14px;border:1px solid var(--gl-line-soft);background:rgba(6,9,8,.5)}
.gl-rivres .s{display:flex;align-items:center;gap:8px;font-size:30px;font-weight:600;font-variant-numeric:lining-nums tabular-nums}
.gl-rivres .s .gl-ic{width:24px;height:24px}
.gl-rivres .s.l .gl-ic{color:var(--gl-leaf)}
.gl-rivres .s.g .gl-ic{color:var(--gl-axe)}
.gl-rivres .win{color:var(--gl-gold-hi)}
.gl-rivres .vd{flex:1;text-align:center;font-style:italic;font-size:17px;color:var(--gl-silver);letter-spacing:.04em}

/* defeat */
.gl-defwrap{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px}
.gl-defeat-t{margin:0;font-weight:500;font-size:clamp(34px,6.2vw,76px);letter-spacing:.2em;padding-left:.2em;text-transform:uppercase;color:#e9d8c2;text-shadow:0 0 40px rgba(190,40,30,.5),0 3px 16px rgba(0,0,0,.9);animation:gl-defeat 2.4s ease-out both}
@keyframes gl-defeat{from{opacity:0;letter-spacing:.38em;filter:blur(6px)}to{opacity:1;letter-spacing:.2em;filter:none}}
.gl-defwrap .why{font-size:clamp(16px,2.2vw,22px);font-style:italic;color:#cdbfae;max-width:min(560px,86vw);margin-top:2px}
.gl-defwrap .gl-orn{width:min(300px,70vw);height:14px;color:#b85a49;margin:12px 0 6px}

/* credits */
.gl-creditswin{position:absolute;inset:0;overflow:hidden;-webkit-mask-image:linear-gradient(180deg,transparent,#000 14%,#000 86%,transparent);mask-image:linear-gradient(180deg,transparent,#000 14%,#000 86%,transparent)}
.gl-cred{position:absolute;left:50%;top:100%;width:min(720px,88vw);transform:translateX(-50%);text-align:center;will-change:transform;animation:gl-roll var(--dur,60s) linear forwards}
@keyframes gl-roll{from{transform:translate(-50%,0)}to{transform:translate(-50%,calc(-100% - 100vh))}}
.gl-cred .gl-emblem{width:110px;color:var(--gl-gold);margin:0 auto 14px}
.gl-cred h2{margin:46px 0 12px;font-weight:500;font-size:13px;letter-spacing:.5em;padding-left:.5em;text-transform:uppercase;color:var(--gl-gold)}
.gl-cred h1{margin:0;font-weight:500;font-size:clamp(40px,8vw,76px);letter-spacing:.26em;padding-left:.26em;color:var(--gl-gold-hi)}
.gl-cred p{margin:6px 0;font-size:clamp(18px,2.6vw,24px);letter-spacing:.12em;color:var(--gl-text);line-height:1.35}
.gl-cred p.sm{font-size:15px;letter-spacing:.06em;color:var(--gl-dim);font-style:italic;line-height:1.45}
.gl-cred .gl-orn{width:260px;height:14px;color:var(--gl-gold);margin:34px auto 0}
.gl-skip{position:absolute;right:var(--pr);bottom:max(env(safe-area-inset-bottom,0px),14px);font-size:12px;letter-spacing:.3em;color:var(--gl-dim);text-transform:uppercase;display:flex;gap:8px;align-items:center;pointer-events:none}

/* narrow: controls become tabs */
@media (max-width:900px){
  .gl-ctlgrid{grid-template-columns:minmax(0,1fr)}
  .gl-ctlcol{display:none}
  .gl-ctlcol.active{display:block}
  .gl-tabs{display:flex}
}
/* phones */
@media (max-width:760px){
  .gl-panel{padding:18px 16px 16px}
  .gl-h1{letter-spacing:.24em;padding-left:.24em}
  .gl-done-top{grid-template-columns:1fr}
  .gl-stats{grid-template-columns:1fr 1fr;gap:0 16px}
  .gl-setgrid{grid-template-columns:minmax(0,1fr)}
  .gl-set{flex-direction:column;align-items:stretch;gap:6px}
  .gl-set:has(.gl-toggle){flex-direction:row;align-items:center}
  .gl-slide{min-width:0;width:100%}
  .gl-seg{width:100%}
  .gl-seg button{flex:1;padding-left:6px;padding-right:6px}
  .gl-back{position:static;order:-1;align-self:flex-start;margin:-6px 0 8px -4px}
  .gl-hints{display:none}
  .gl-screen.has-hints{padding-bottom:var(--pb)}
  .gl-up{grid-template-columns:40px 1fr;padding:11px 12px}
  .gl-up .ic{width:40px;height:40px}
  .gl-up .buy{grid-column:1/3;grid-row:auto;flex-direction:row;justify-content:space-between;min-width:0}
  .gl-chgrid{grid-template-columns:1fr}
  .gl-back{padding:7px 12px;min-height:38px}
}
@media (max-width:480px){
  .gl-logo{font-size:38px;letter-spacing:.2em;padding-left:.2em}
  .gl-tag{letter-spacing:.14em}
}
@media (max-height:480px){
  .gl-screen{padding-top:max(env(safe-area-inset-top,0px),8px);padding-bottom:max(env(safe-area-inset-bottom,0px),8px)}
  .gl-panel{padding:14px 22px 12px}
  .gl-panel > .gl-orn{margin:6px auto 8px}
  .gl-h1{font-size:20px}
  .gl-btn{min-height:44px;padding-top:9px;padding-bottom:9px}
  .gl-emblem{display:none}
  .gl-logo{font-size:clamp(38px,12vh,70px)}
  .gl-tag{margin-top:2px;font-size:14px}
  .gl-title-wrap .gl-orn{margin:6px 0 4px}
  .gl-tm{padding-top:5px;padding-bottom:5px;font-size:16px}
  .gl-tmenu{display:grid;grid-template-columns:1fr 1fr;column-gap:12px}
  .gl-hints,.gl-foot{display:none}
  .gl-done-top{gap:16px}
  .gl-rank{width:96px;height:96px;font-size:56px}
  .gl-stat{padding:4px 2px}
  .gl-stat b{font-size:18px}
  .gl-defeat-t{font-size:38px}
  .gl-loading .gl-emblem{display:none}
  .gl-reward{margin-top:8px}
  .gl-rivres{margin-top:8px;padding:6px 10px}
  .gl-actions{margin-top:10px}
  .gl-set{padding:6px 6px}
  .gl-bind{padding:4px 2px;font-size:15px}
  .gl-pausewrap{min-width:min(560px,92vw)}
  .gl-pausewrap .gl-sub-ch{display:none}
  .gl-actions.col{display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:0}
  .gl-actions.col .primary{grid-column:1/3}
  .gl-actions.col .gl-btn{min-height:40px;padding-top:6px;padding-bottom:6px}
  .gl-donewrap .gl-lede{margin-top:2px;font-size:15px}
  .gl-donewrap{padding-top:10px}
  .gl-stats{gap:0 20px}
  .gl-stat{padding:2px 2px}
  .gl-rank{width:84px;height:84px;font-size:50px}
  .gl-reward{margin-top:4px;font-size:14px}
  .gl-reward b{font-size:22px}
  .gl-rivres{margin-top:6px;padding:3px 10px}
  .gl-rivres .s{font-size:24px}
  .gl-donewrap .gl-actions{margin-top:8px}
  .gl-donewrap .gl-btn{min-height:38px}
}
@media (prefers-reduced-motion:reduce){
  .gl-screen,.gl-emblem,.gl-cred,.gl-defeat-t{animation-duration:.01s!important}
}
`;

let injected = false;

export function injectStyles(): void {
  if (injected || typeof document === 'undefined') return;
  if (document.getElementById('gl-styles')) {
    injected = true;
    return;
  }
  const s = document.createElement('style');
  s.id = 'gl-styles';
  s.textContent = TOKENS + HUD + TOUCH + MENUS;
  document.head.appendChild(s);
  injected = true;
}
