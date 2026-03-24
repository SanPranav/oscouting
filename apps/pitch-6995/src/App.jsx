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
        const response = await fetch(`${TBA_API_BASE}/team/frc6995/events`);
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

        const teamMatches = matches.filter(
          (m) => Array.isArray(m.alliances?.blue?.team_keys) &&
                 (m.alliances.blue.team_keys.includes('frc6995') ||
                  m.alliances.red.team_keys.includes('frc6995'))
        );

        const videoClips = teamMatches
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
          <h1 className="mt-3 text-4xl font-bold tracking-tight lg:text-5xl">Why Team 6995 Is a Winning Pick</h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">
            Team 6995 delivers reliable cycle value, playoff composure, and strong alliance coordination.
            We are a dependable eliminations partner with high strategic fit.
          </p>
          <div className="mt-6 inline-flex items-center rounded-full border border-input bg-background px-4 py-2 text-sm">
            Pick 6995 for consistency + adaptability + endgame value
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <article className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Reliable Match-to-Match Output</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              6995 provides stable production and repeatable execution under pressure.
            </p>
          </article>

          <article className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Strong Partner Fit</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Flexible role coverage makes 6995 a strong complement for offense-first or defense-first captains.
            </p>
          </article>

          <article className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Disciplined Play</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Smart positioning and low-risk decision making preserve points in tight playoff matches.
            </p>
          </article>

          <article className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Drive Team Communication</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Clear comms and rapid in-match adjustments keep alliance strategy synchronized.
            </p>
          </article>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-2xl font-bold">Quick Captain Summary</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>High-value complementary robot for top-seed alliance builds.</li>
            <li>Dependable execution profile in playoff-pressure scenarios.</li>
            <li>Prepared strategy communication and fast adaptation between matches.</li>
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
            <h2 className="text-2xl font-bold">Data-Driven Strategy Workflow</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Our alliance prep combines scouting data, matchup modeling, and live strategy adjustments for confident pick decisions.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-input bg-background/40 p-4">
              <p className="text-sm font-semibold">Match Prediction Insights</p>
              <p className="text-xs text-muted-foreground mt-2">EPA and scouting fusion to estimate match outcomes and role fit.</p>
            </div>
            <div className="rounded-lg border border-input bg-background/40 p-4">
              <p className="text-sm font-semibold">Reliability Metrics</p>
              <p className="text-xs text-muted-foreground mt-2">Reliability, cycle consistency, and endgame contribution tracked for alliance confidence.</p>
            </div>
            <div className="rounded-lg border border-input bg-background/40 p-4">
              <p className="text-sm font-semibold">Alliance Simulation</p>
              <p className="text-xs text-muted-foreground mt-2">Draft simulation and probable partner analysis for elimination planning.</p>
            </div>
            <div className="rounded-lg border border-input bg-background/40 p-4">
              <p className="text-sm font-semibold">Tactical Planning</p>
              <p className="text-xs text-muted-foreground mt-2">Rapid matchup-specific calls and adaptive strategy guidance.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
