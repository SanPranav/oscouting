import { useEffect, useState } from 'react';
import { AlertCircle, Film, BarChart3 } from 'lucide-react';

const TBA_API_BASE = 'https://www.thebluealliance.com/api/v3';

export default function App() {
  const [clips, setClips] = useState([]);
  const [clipsLoading, setClipsLoading] = useState(true);
  const [clipsError, setClipsError] = useState('');

  useEffect(() => {
    const fetchClips = async () => {
      try {
        setClipsLoading(true);
        setClipsError('');
        const response = await fetch(`${TBA_API_BASE}/team/frc3749/events`);
        if (!response.ok) throw new Error('Failed fetching events');
        const events = await response.json();

        const recentEvent = events
          .filter((e) => e.year === 2026 && e.event_type < 4)
          .sort((a, b) => (b.end_date || '').localeCompare(a.end_date || ''))[0];

        if (!recentEvent) {
          setClips([]);
          setClipsLoading(false);
          return;
        }

        const matchesResponse = await fetch(`${TBA_API_BASE}/event/${recentEvent.key}/matches`);
        if (!matchesResponse.ok) throw new Error('Failed fetching matches');
        const matches = await matchesResponse.json();

        const team3749Matches = matches.filter(
          (m) => Array.isArray(m.alliances?.blue?.team_keys) &&
                 (m.alliances.blue.team_keys.includes('frc3749') ||
                  m.alliances.red.team_keys.includes('frc3749'))
        );

        const videoClips = team3749Matches
          .filter((m) => m.videos && m.videos.length > 0)
          .slice(0, 6)
          .map((m) => ({
            id: m.key,
            matchKey: m.match_number,
            compLevel: m.comp_level,
            video: m.videos[0]
          }));

        setClips(videoClips);
      } catch (err) {
        setClipsError(String(err.message || 'Failed loading clips'));
        setClips([]);
      } finally {
        setClipsLoading(false);
      }
    };

    fetchClips();
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6 lg:p-10">
      <div className="space-y-8">
        <section className="rounded-2xl border border-border bg-card p-6 lg:p-8">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Alliance Selection Pitch</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight lg:text-5xl">Why Team 3749 Is a Winning Pick</h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">
            Team 3749 brings balanced scoring, dependable execution, and strong on-field communication.
            We are the robot you can trust in elimination pressure.
          </p>
          <div className="mt-5">
            <a
              href="/system-guide.html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-full border border-input bg-background px-4 py-2 text-xs font-semibold text-foreground hover:bg-accent/10"
            >
              Open System Docs + Formulas
            </a>
          </div>
          <div className="mt-6 inline-flex items-center rounded-full border border-input bg-background px-4 py-2 text-sm">
            Pick 3749 for consistency + adaptability + endgame value
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <article className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Reliable Match-to-Match Output</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              We minimize dead matches and execute a repeatable cycle plan under defense.
            </p>
          </article>

          <article className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Strong Partner Fit</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              3749 complements both offense-first and defense-first captains with role flexibility.
            </p>
          </article>

          <article className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Clean, Disciplined Play</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Smart foul management and clean field movement preserve points in close playoff sets.
            </p>
          </article>

          <article className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Drive Team Communication</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Fast pre-match planning and in-match adjustments keep the alliance synchronized.
            </p>
          </article>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-2xl font-bold">Quick Captain Summary</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>High-value complementary robot for top-seed compositions.</li>
            <li>Dependable under pressure with predictable playoff behavior.</li>
            <li>Prepared strategy communication and rapid adaptation between matches.</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6 lg:p-8">
          <div className="flex items-center gap-3 mb-4">
            <Film className="h-6 w-6 text-accent" />
            <h2 className="text-2xl font-bold">Recent Highlights</h2>
          </div>
          {clipsError ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {clipsError}
            </div>
          ) : clipsLoading ? (
            <p className="text-sm text-muted-foreground">Loading match clips from Blue Alliance...</p>
          ) : clips.length > 0 ? (
            <div className="grid gap-4 mt-4 md:grid-cols-2 lg:grid-cols-3">
              {clips.map((clip) => (
                <a
                  key={clip.id}
                  href={clip.video.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative rounded-lg overflow-hidden border border-border bg-background/40 hover:border-accent transition-colors"
                >
                  <div className="aspect-video bg-muted flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-foreground">▶</p>
                      <p className="text-xs text-muted-foreground mt-1">Watch Match</p>
                    </div>
                  </div>
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                    <p className="text-sm font-semibold">{clip.compLevel.toUpperCase()} {clip.matchKey}</p>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No recent match videos available yet.</p>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-6 lg:p-8">
          <div className="flex items-center gap-3 mb-4">
            <BarChart3 className="h-6 w-6 text-accent" />
            <h2 className="text-2xl font-bold">Our Strategy Dashboard</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            3749 uses an insane data-driven strategy platform with real-time scouting, AI predictions, and live team analysis.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-input bg-background/40 p-4">
              <p className="text-sm font-semibold">Match Prediction Engine</p>
              <p className="text-xs text-muted-foreground mt-2">Statbotics EPA integration + scouting data fusion for accurate blue/red score forecasts.</p>
            </div>
            <div className="rounded-lg border border-input bg-background/40 p-4">
              <p className="text-sm font-semibold">Live Team Stats</p>
              <p className="text-xs text-muted-foreground mt-2">Spider charts, reliability metrics, cycle speed, defense rating—every bot on a dashboard.</p>
            </div>
            <div className="rounded-lg border border-input bg-background/40 p-4">
              <p className="text-sm font-semibold">Alliance Probability Simulator</p>
              <p className="text-xs text-muted-foreground mt-2">TBA rankings + serpentine draft modeling. See probable alliances in real time during selection.</p>
            </div>
            <div className="rounded-lg border border-input bg-background/40 p-4">
              <p className="text-sm font-semibold">Tactical AI Analysis</p>
              <p className="text-xs text-muted-foreground mt-2">Brick AI breaks down opponent threats, weakness windows, and drive-team matchup calls.</p>
            </div>
            <div className="rounded-lg border border-input bg-background/40 p-4">
              <p className="text-sm font-semibold">Robot Status & Reliability</p>
              <p className="text-xs text-muted-foreground mt-2">Disable rates, tip trends, foul patterns—detect reliability risks before playoffs.</p>
            </div>
            <div className="rounded-lg border border-input bg-background/40 p-4">
              <p className="text-sm font-semibold">Multi-Event Strategic Insights</p>
              <p className="text-xs text-muted-foreground mt-2">Cross-event data aggregation and global team comparisons for confident pick recommendations.</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            When 3749 walks into alliance selection, we know our matchup space better than anyone. That advantage translates to playoff wins.
          </p>
        </section>
      </div>
    </main>
  );
}
