import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, PlayCircle, Target } from 'lucide-react';

const CORE_STATS = [
  '5-6 fuel per second',
  '40+ ball hopper capacity',
  'Basic 5-point auto: straight back, no path blocking',
  'Midfield passing proven in-match',
  'Intake fixed and stable'
];

const POSTER_FOCUS = [
  {
    id: 'stats',
    title: 'Statistics Panel',
    summary: 'BPS, hopper size, auto profile, top speed, and weight are front-and-center for quick captain review.',
    detail: 'This anchors our pick value in measured output and known role fit.',
    x: 1.5,
    y: 24,
    zoom: 240
  },
  {
    id: 'drum',
    title: 'Drum Shooter',
    summary: 'Drum shooter + flywheel configuration section highlights shot consistency and feed path.',
    detail: 'The shooter architecture supports stable throughput and clean handoff from intake to scoring.',
    x: 94,
    y: 34,
    zoom: 200
  },
  {
    id: 'intake',
    title: 'Intake + Drive Base',
    summary: 'Intake hardware and drivetrain detail zone for role-fit and cycle viability discussion.',
    detail: 'Recent intake stability fixes directly improve cycle reliability under traffic and defense.',
    x: 34,
    y: 57,
    zoom: 230
  },
  {
    id: 'cad',
    title: 'CAD Integration View',
    summary: 'Onshape model is connected for geometry-level discussion on packaging and clearances.',
    detail: 'Use this view to answer captain questions around subsystem layout and maintenance access.',
    x: 55,
    y: 49,
    zoom: 170
  }
];

const CAD_URL =
  'https://cad.onshape.com/documents/a5088f7ac123b97a9a4614dc/w/8f256aaec01c83a28dba4058/e/c8f3953365aa84050e03c2e4?configuration=default&renderMode=0&uiState=69d14c29d55390586ab1798e1';

const VIDEO_SLIDES = [
  {
    id: 'q10',
    title: 'Qual 10 Passing (0:52-0:58)',
    note: 'Midfield passing sequence. Intake fix now makes this action repeatable.',
    embed: 'https://www.youtube.com/embed/5Lmilw1VQgg?start=52&end=58&rel=0',
    cta: 'https://www.youtube.com/watch?v=5Lmilw1VQgg&t=52s'
  },
  {
    id: 'q16',
    title: 'Qual 16 Defense (1:56-2:07)',
    note: 'Second-half defense on 2637; beaching issue was fixed after this match.',
    embed: 'https://www.youtube.com/embed/dtGHVJEymwo?start=116&end=127&rel=0',
    cta: 'https://www.youtube.com/watch?v=dtGHVJEymwo&t=116s'
  },
  {
    id: 'q51',
    title: 'Qual 51 Result Context',
    note: '108 points by 3749 in this match window. Context: other two alliance robots were kitbots/no-shows.',
    embed: '',
    cta: 'https://www.thebluealliance.com/match/2026caasv_qm51'
  }
];

export default function App() {
  const [imageReady, setImageReady] = useState(true);
  const [activeFocusId, setActiveFocusId] = useState(POSTER_FOCUS[0].id);

  const activeFocus = useMemo(
    () => POSTER_FOCUS.find((focus) => focus.id === activeFocusId) || POSTER_FOCUS[0],
    [activeFocusId]
  );

  useEffect(() => {
    const targets = Array.from(document.querySelectorAll('[data-focus-step]'));
    if (!targets.length) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (!visible.length) {
          return;
        }

        const nextId = visible[0].target.getAttribute('data-focus-step');
        if (nextId) {
          setActiveFocusId(nextId);
        }
      },
      { threshold: [0.3, 0.45, 0.6], rootMargin: '-12% 0px -38% 0px' }
    );

    targets.forEach((item) => observer.observe(item));

    return () => observer.disconnect();
  }, []);

  return (
    <main className="pitch-shell mx-auto min-h-screen max-w-7xl p-6 lg:p-10">
      <div className="mb-4 flex items-center justify-between text-xs text-cyan-100/85">
        <span className="rounded-full border border-cyan-300/25 bg-cyan-500/10 px-3 py-1">Immersive Scroll Mode</span>
        <span>Scroll down to move the camera across the poster</span>
      </div>

      <section className="pitch-hero rounded-2xl border border-white/15 p-6 lg:p-10">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">Alliance Selection Pitch</p>
            <h1 className="mt-3 text-4xl font-extrabold tracking-tight lg:text-6xl">Team 3749: Pitch Deck</h1>
            <p className="mt-4 max-w-2xl text-sm text-blue-100/90 lg:text-base">
              High-value complementary robot with verified in-match passing, defensive adaptability, and stable scoring throughput.
              Built for playoff role execution.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {CORE_STATS.map((item) => (
                <div key={item} className="rounded-lg border border-cyan-300/20 bg-blue-950/35 px-3 py-2 text-sm text-cyan-50">
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <a
                href="https://docs.google.com/document/d/1UF87060v9X_cfJ2aWu1kwGoDpY86JgY42A1Mw_u3JHw/edit?usp=sharing"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-500/15 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25"
              >
                Open Technical Docs
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-blue-100">
                2026 Aerospace Valley
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-300/20 bg-blue-950/45 p-3">
            {imageReady ? (
              <img
                src="/image.png"
                alt="Team 3749 Valkyrie technical sheet"
                className="h-full w-full rounded-xl object-cover"
                onError={() => setImageReady(false)}
              />
            ) : (
              <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed border-cyan-300/40 bg-blue-900/35 p-4 text-center text-sm text-cyan-100/90">
                Add your uploaded sheet image as
                <br />
                <span className="font-semibold">apps/pitch/public/image.png</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-cyan-300/15 bg-blue-950/30 p-5 lg:p-8">
        <div className="mb-4 flex items-center gap-3">
          <Target className="h-6 w-6 text-cyan-200" />
          <h2 className="text-2xl font-bold">Poster Walkthrough</h2>
        </div>
        <p className="mb-4 text-sm text-blue-100/85">
          One camera, one poster. As each story block enters view, the poster smoothly zooms to that subsystem.
        </p>
        <div className="poster-story-grid gap-4 lg:gap-6">
          <div className="space-y-4">
            {POSTER_FOCUS.map((focus) => (
              <article
                key={focus.id}
                data-focus-step={focus.id}
                className={`focus-step rounded-xl border p-4 lg:p-5 ${focus.id === activeFocus.id ? 'is-active' : ''}`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/90">Poster Focus</p>
                <h3 className="mt-2 text-xl font-bold text-cyan-50">{focus.title}</h3>
                <p className="mt-2 text-sm text-blue-100/85">{focus.summary}</p>
                <p className="mt-3 text-sm text-cyan-100/90">{focus.detail}</p>
              </article>
            ))}
          </div>

          <aside className="poster-pin">
            <div className="rounded-xl border border-cyan-300/15 bg-blue-900/35 p-4">
              {imageReady ? (
                <div
                  className="poster-camera"
                  style={{
                    backgroundImage: "url('/image.png')",
                    backgroundPosition: `${activeFocus.x}% ${activeFocus.y}%`,
                    backgroundSize: `${activeFocus.zoom}%`
                  }}
                />
              ) : (
                <div className="flex h-[58vh] min-h-[320px] items-center justify-center rounded-lg border border-dashed border-cyan-300/30 text-xs text-cyan-100/80">
                  image unavailable
                </div>
              )}
              <div className="mt-4 rounded-lg border border-cyan-300/20 bg-blue-950/40 p-3">
                <h4 className="text-sm font-semibold text-cyan-100">Active camera target: {activeFocus.title}</h4>
                <p className="mt-1 text-xs text-blue-100/80">{activeFocus.summary}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              {POSTER_FOCUS.map((focus) => (
                <button
                  key={focus.id}
                  type="button"
                  aria-label={`Go to ${focus.title}`}
                  className={`h-2.5 rounded-full transition-all ${focus.id === activeFocus.id ? 'w-8 bg-cyan-300' : 'w-2.5 bg-cyan-300/35 hover:bg-cyan-300/60'}`}
                  onClick={() => {
                    setActiveFocusId(focus.id);
                    document.querySelector(`[data-focus-step="${focus.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                />
              ))}
            </div>
          </aside>
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-cyan-300/15 bg-blue-950/35 p-6 lg:p-8">
        <h2 className="text-2xl font-bold">Live CAD View</h2>
        <p className="mt-2 text-sm text-blue-100/85">
          CAD is embedded for technical deep-dives during the pitch. Use it to support packaging, subsystem, and serviceability questions.
        </p>
        <div className="mt-4 rounded-xl border border-cyan-300/20 bg-blue-900/35 p-5">
          <div className="rounded-lg border border-cyan-300/20 bg-blue-950/45 p-4">
            <p className="text-sm font-semibold text-cyan-100">Onshape blocks external iframe embedding for this doc.</p>
            <p className="mt-2 text-xs text-blue-100/85">
              This is expected behavior from Onshape security headers. Launch the CAD directly in a new tab during the pitch for full interactive model control.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={CAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25"
              >
                Launch Onshape CAD
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <a
                href="https://cad.onshape.com/signin"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-cyan-300/20 bg-blue-900/60 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-blue-800/65"
              >
                Open Onshape Sign-in
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
        <a
          href={CAD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20"
        >
          Open CAD in Onshape
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </section>

      <section className="mt-8 rounded-2xl border border-cyan-300/15 bg-blue-950/35 p-6 lg:p-8">
        <div className="mb-4 flex items-center gap-3">
          <PlayCircle className="h-6 w-6 text-cyan-200" />
          <h2 className="text-2xl font-bold">Proof Clips</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {VIDEO_SLIDES.map((item) => (
            <article key={item.id} className="rounded-xl border border-cyan-300/15 bg-blue-900/35 p-4">
              <h3 className="text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-xs text-blue-100/85">{item.note}</p>
              {item.embed ? (
                <div className="mt-3 overflow-hidden rounded-lg border border-cyan-300/20">
                  <iframe
                    className="video-frame"
                    src={item.embed}
                    title={item.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-cyan-300/20 bg-blue-950/45 p-3 text-xs text-cyan-100/90">
                  This match clip is currently being published. Use TBA match link for live score context.
                </div>
              )}
              <a
                href={item.cta}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20"
              >
                Open Source
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-cyan-300/15 bg-blue-950/30 p-6">
        <h2 className="text-xl font-bold">Captain Snapshot</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-cyan-300/15 bg-blue-900/40 p-4 text-sm text-blue-100/90">
            Pick value: strong complementary robot that can pass, score, and shift roles by match state.
          </div>
          <div className="rounded-lg border border-cyan-300/15 bg-blue-900/40 p-4 text-sm text-blue-100/90">
            Reliability update: intake and beaching issues addressed; current config supports cleaner cycle execution.
          </div>
        </div>
      </section>
    </main>
  );
}
