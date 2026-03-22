import { useEffect, useState } from 'react';
import { Bot, MessageCircle, Radar, Send, Sparkles, X } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';

const API_BASE = import.meta.env.VITE_API_BASE || '';

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function buildSpiderMetrics(stat) {
  return [
    Number(stat?.spiderAuto || 0),
    Number(stat?.spiderTeleop || 0),
    Number(stat?.spiderDefense || 0),
    Number(stat?.spiderCycleSpeed || 0),
    Number(stat?.spiderReliability || 0),
    Number(stat?.spiderEndgame || 0)
  ].map((value) => clamp(Number(value || 0)));
}

function SpiderChart({ stat }) {
  if (!stat) return null;

  const metrics = buildSpiderMetrics(stat);

  const labels = ['Auto', 'Teleop', 'Defense', 'Cycle', 'Reliability', 'Endgame'];
  const cx = 120;
  const cy = 120;
  const r = 88;

  const points = metrics.map((value, index) => {
    const angle = (-90 + index * 60) * (Math.PI / 180);
    const rr = r * (value / 100);
    return `${cx + Math.cos(angle) * rr},${cy + Math.sin(angle) * rr}`;
  }).join(' ');

  const axis = labels.map((label, index) => {
    const angle = (-90 + index * 60) * (Math.PI / 180);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    const lx = cx + Math.cos(angle) * (r + 20);
    const ly = cy + Math.sin(angle) * (r + 20);
    return (
      <g key={label}>
        <line x1={cx} y1={cy} x2={x} y2={y} stroke="currentColor" opacity="0.28" />
        <text x={lx} y={ly} fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.92">{label}</text>
      </g>
    );
  });

  return (
    <svg viewBox="0 0 240 240" className="h-64 w-64 text-foreground">
      <rect x="14" y="14" width="212" height="212" rx="12" fill="currentColor" opacity="0.04" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" opacity="0.36" />
      <circle cx={cx} cy={cy} r={r * 0.66} fill="none" stroke="currentColor" opacity="0.24" />
      <circle cx={cx} cy={cy} r={r * 0.33} fill="none" stroke="currentColor" opacity="0.16" />
      {axis}
      <polygon points={points} fill="currentColor" fillOpacity="0.28" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}

export default function App() {
  const [eventKey, setEventKey] = useState('2026casnd');
  const [matchKey, setMatchKey] = useState('2026casnd_qm5');
  const [teamNumber, setTeamNumber] = useState('3749');
  const [result, setResult] = useState(null);
  const [teamDetail, setTeamDetail] = useState(null);
  const [robotStatus, setRobotStatus] = useState([]);
  const [scheduleRows, setScheduleRows] = useState([]);
  const [pickLeaderboard, setPickLeaderboard] = useState([]);
  const [schedulePasteText, setSchedulePasteText] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [error, setError] = useState('');
  const [team3749Ready, setTeam3749Ready] = useState(true);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionProgress, setPredictionProgress] = useState(0);
  const [predictionLoadingLabel, setPredictionLoadingLabel] = useState('Loading prediction...');
  const [brickOpen, setBrickOpen] = useState(false);
  const [brickInput, setBrickInput] = useState('');
  const [brickLoading, setBrickLoading] = useState(false);
  const [brickTypingDots, setBrickTypingDots] = useState('.');
  const [brickMessages, setBrickMessages] = useState([
    {
      role: 'assistant',
      text: 'Brick AI ready. Ask about team strengths, weaknesses, matchup plans, or reliability trends.'
    }
  ]);

  const fetchJsonWithProgress = async (url, options = {}) => {
    const response = await fetch(url, options);
    setPredictionProgress(70);
    const data = await response.json();
    setPredictionProgress(95);
    return { response, data };
  };

  const runPrediction = async () => {
    try {
      setError('');
      setPredictionLoading(true);
      setPredictionProgress(0);
      setPredictionLoadingLabel('Generating match prediction...');

      const { response, data } = await fetchJsonWithProgress(
        `${API_BASE}/api/strategy/predict/${eventKey}/${matchKey}?team3749Ready=${team3749Ready}`
      );
      if (!response.ok) {
        setError(data.error || 'Prediction failed');
        setResult(null);
        return;
      }
      setPredictionProgress(100);
      setResult(data);
    } catch {
      setError('Server unreachable. Start backend on http://localhost:2540.');
      setResult(null);
    } finally {
      setPredictionLoading(false);
      setPredictionProgress(0);
    }
  };

  const loadTeamPanels = async () => {
    try {
      setError('');
      const [detailRes, statusRes] = await Promise.all([
        fetch(`${API_BASE}/api/strategy/stats/${eventKey}/${teamNumber}`),
        fetch(`${API_BASE}/api/strategy/robot-status/${eventKey}`)
      ]);

      const detail = await detailRes.json();
      const status = await statusRes.json();

      if (!detailRes.ok) throw new Error(detail.error || 'Failed loading team detail');
      if (!statusRes.ok) throw new Error(status.error || 'Failed loading robot status');

      setTeamDetail(detail);
      setRobotStatus(Array.isArray(status) ? status : []);
    } catch (err) {
      setError(err.message || 'Failed loading dashboard panels');
    }
  };

  const loadSchedule = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/strategy/schedule/${eventKey}?team=3749`);
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Failed loading schedule');
        return;
      }
      setScheduleRows(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed loading schedule');
    }
  };

  const loadLeaderboard = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/strategy/leaderboard/${eventKey}?ourTeam=${teamNumber}&limit=12`);
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Failed loading leaderboard');
        return;
      }

      setPickLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : []);
    } catch {
      setError('Failed loading leaderboard');
    }
  };

  const importScheduleFromPaste = async () => {
    try {
      setError('');
      setImportMessage('Importing schedule...');
      const response = await fetch(`${API_BASE}/api/import/paste`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventKey, text: schedulePasteText, type: 'auto' })
      });

      const data = await response.json();
      if (!response.ok) {
        setImportMessage(data.error || 'Schedule import failed');
        return;
      }

      const resolvedEventKey = data.eventKey || eventKey;
      if (resolvedEventKey !== eventKey) {
        setEventKey(resolvedEventKey);
      }

      if (data.importedMatches !== undefined) {
        setImportMessage(`Imported ${data.importedMatches} matches into ${resolvedEventKey}`);
      } else {
        setImportMessage(`Import complete for ${resolvedEventKey}`);
      }

      await loadSchedule();
      await loadLeaderboard();
    } catch {
      setImportMessage('Schedule import failed. Server unreachable.');
    }
  };

  const askBrickAi = async () => {
    const question = brickInput.trim();
    if (!question || brickLoading) return;

    const userMessage = { role: 'user', text: question };
    setBrickMessages((prev) => [...prev, userMessage]);
    setBrickInput('');
    setBrickLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/strategy/brick-ai/${eventKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, teamNumber })
      });

      const data = await response.json();
      if (!response.ok) {
        setBrickMessages((prev) => [
          ...prev,
          { role: 'assistant', text: data.error || 'Brick AI request failed.' }
        ]);
        return;
      }

      const answerText = String(data.answer || 'No answer returned.');
      const warningText = data.degraded && data.warning
        ? `\n\n(Using fallback mode: ${data.warning})`
        : '';

      setBrickMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `${answerText}${warningText}` }
      ]);
    } catch {
      setBrickMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'Brick AI is unavailable right now. Check server + model runtime.' }
      ]);
    } finally {
      setBrickLoading(false);
    }
  };

  useEffect(() => {
    if (!brickLoading) {
      setBrickTypingDots('.');
      return;
    }

    const frames = ['.', '..', '...'];
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % frames.length;
      setBrickTypingDots(frames[idx]);
    }, 400);

    return () => clearInterval(interval);
  }, [brickLoading]);

  useEffect(() => {
    loadSchedule();
    loadLeaderboard();
    const timer = setInterval(loadSchedule, 30000);
    const leaderboardTimer = setInterval(loadLeaderboard, 30000);
    return () => {
      clearInterval(timer);
      clearInterval(leaderboardTimer);
    };
  }, [eventKey, teamNumber]);

  return (
    <main className="mx-auto min-h-screen max-w-[1500px] p-6 lg:p-8">
      <div className="space-y-8 pb-28">
        <Card>
          <CardHeader className="pb-4">
            <div className="mb-2 flex items-center gap-2">
              <Radar className="h-5 w-5 text-foreground" />
              <Badge>Drive Dashboard</Badge>
            </div>
            <CardTitle>Match Prediction</CardTitle>
            <CardDescription>Use local scouting stats plus AI narrative for strategy calls.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Input value={eventKey} onChange={(e) => setEventKey(e.target.value)} placeholder="event key" />
              <Input value={matchKey} onChange={(e) => setMatchKey(e.target.value)} placeholder="match id (5, qm5, or 2026casnd_qm5)" />
              <Input value={teamNumber} onChange={(e) => setTeamNumber(e.target.value)} placeholder="team for spider/status" />
              <div className="flex gap-2">
                <Button className="w-full gap-2" onClick={runPrediction} disabled={predictionLoading}>
                  <Sparkles className="h-4 w-4" />
                  {predictionLoading ? 'Predicting...' : 'Predict Match'}
                </Button>
                <Button variant="outline" className="w-full" onClick={loadTeamPanels}>Load Panels</Button>
              </div>
            </div>

            <div className="rounded-md border border-input p-3">
              <p className="mb-2 text-sm font-medium">Team 3749 Status</p>
              <button
                type="button"
                role="switch"
                aria-checked={team3749Ready}
                onClick={() => setTeam3749Ready((current) => !current)}
                className={`inline-flex h-6 w-12 items-center rounded-full transition-colors ${team3749Ready ? 'bg-primary' : 'bg-muted'}`}
              >
                <span
                  className={`h-5 w-5 rounded-full bg-background shadow transition-transform ${team3749Ready ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
              <p className="mt-2 text-xs text-muted-foreground">
                {team3749Ready
                  ? 'TRUE: prioritize balanced offense + selective defense.'
                  : 'FALSE: prioritize defensive disruption and low-risk cycles.'}
              </p>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            {predictionLoading ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{predictionLoadingLabel}</span>
                  <span>{Math.round(predictionProgress)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-150"
                    style={{ width: `${predictionProgress}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
              <section className="space-y-6">
                {result ? (
                  <Card className="border-primary/40">
                    <CardHeader>
                      <CardTitle className="text-base">{result.matchKey}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <p>Red: <span className="font-semibold">{result.redPredicted}</span> | Blue: <span className="font-semibold">{result.bluePredicted}</span></p>
                      <p>Confidence: {result.confidence}</p>
                      {result.dataQuality ? (
                        <div className="rounded-md border border-input p-2 text-xs text-muted-foreground">
                          <p>
                            Data quality · Red points coverage: <span className="font-semibold">{result.dataQuality.red?.pointsCoveragePct ?? 0}%</span>
                            {' '}| Blue points coverage: <span className="font-semibold">{result.dataQuality.blue?.pointsCoveragePct ?? 0}%</span>
                          </p>
                          <p>
                            Team sources:{' '}
                            {(result.dataQuality.byTeam || [])
                              .map((entry) => `${entry.teamNumber}:${entry.source}`)
                              .join(', ')}
                          </p>
                        </div>
                      ) : null}
                      {result.team3749Playing ? <p>3749 alliance: <span className="font-semibold">{result.ourAlliance}</span></p> : <p className="font-semibold">3749 is not playing.</p>}
                      {Array.isArray(result.opponentWeaknesses) && result.opponentWeaknesses.length ? (
                        <div>
                          <p className="font-medium">Opponent Weaknesses</p>
                          <ul className="list-disc pl-5 text-muted-foreground">
                            {result.opponentWeaknesses.slice(0, 5).map((weakness) => (
                              <li key={weakness}>{weakness}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {Array.isArray(result.opponentStrengths) && result.opponentStrengths.length ? (
                        <div>
                          <p className="font-medium">Opponent Strengths</p>
                          <ul className="list-disc pl-5 text-muted-foreground">
                            {result.opponentStrengths.slice(0, 4).map((strength) => (
                              <li key={strength}>{strength}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <p className="text-muted-foreground">{result.narrative}</p>
                    </CardContent>
                  </Card>
                ) : null}

                {result?.tacticalPlan ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Drive-Team Tactical Strategy</CardTitle>
                      <CardDescription>Concise calls for 2026 Reefscape: mobility, lane denial, endgame conversion.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                      <div className="flex items-center justify-between rounded-md border border-input p-2">
                        <p className="text-xs text-muted-foreground">Strategy Mode</p>
                        <Badge className="border border-input bg-background text-foreground">{result.tacticalPlan.mode || 'balanced'}</Badge>
                      </div>

                      {result.tacticalPlan.primaryThreat ? (
                        <div className="rounded-md border border-input p-3">
                          <p className="font-semibold">Primary Threat · Team {result.tacticalPlan.primaryThreat.teamNumber}</p>
                          <p className="text-muted-foreground">{result.tacticalPlan.primaryThreat.reason}</p>
                          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                            <p>Threat: <span className="font-semibold">{result.tacticalPlan.primaryThreat.threatLevel}</span></p>
                            <p>Teleop: <span className="font-semibold">{result.tacticalPlan.primaryThreat.stats.teleopScore}</span></p>
                            <p>Endgame: <span className="font-semibold">{result.tacticalPlan.primaryThreat.stats.endgameScore}</span></p>
                            <p>Cycle: <span className="font-semibold">{result.tacticalPlan.primaryThreat.stats.cycleSpeed || 'N/A'}</span></p>
                            <p>EPA: <span className="font-semibold">{result.tacticalPlan.primaryThreat.stats.statboticsEPA || '0.00'}</span></p>
                            <p>Window: <span className="font-semibold">{result.tacticalPlan.primaryThreat.stats.exploitable}</span></p>
                          </div>
                          {Array.isArray(result.tacticalPlan.primaryThreat.habits) && result.tacticalPlan.primaryThreat.habits.length ? (
                            <div className="mt-2">
                              <p className="text-xs font-medium">Opponent Habits</p>
                              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                                {result.tacticalPlan.primaryThreat.habits.map((habit) => (
                                  <li key={habit}>{habit}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="rounded-md border border-input p-3">
                        <p className="font-medium">Auto Call</p>
                        <p className="text-muted-foreground">{result.tacticalPlan.autoRecommendation}</p>
                      </div>

                      {Array.isArray(result.tacticalPlan.offensePlan) && result.tacticalPlan.offensePlan.length ? (
                        <div className="rounded-md border border-input p-3">
                          <p className="font-medium">Shooting and Cycle Plan</p>
                          <ul className="list-disc pl-5 text-muted-foreground">
                            {result.tacticalPlan.offensePlan.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {Array.isArray(result.tacticalPlan.defensePlan) && result.tacticalPlan.defensePlan.length ? (
                        <div className="rounded-md border border-input p-3">
                          <p className="font-medium">Defense Plan</p>
                          <ul className="list-disc pl-5 text-muted-foreground">
                            {result.tacticalPlan.defensePlan.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {Array.isArray(result.tacticalPlan.habitCounters) && result.tacticalPlan.habitCounters.length ? (
                        <div className="rounded-md border border-input p-3">
                          <p className="font-medium">Habit Counters</p>
                          <ul className="list-disc pl-5 text-muted-foreground">
                            {result.tacticalPlan.habitCounters.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {Array.isArray(result.tacticalPlan.concisePlan) && result.tacticalPlan.concisePlan.length ? (
                        <div className="rounded-md border border-input p-3">
                          <p className="font-medium">Quick Calls</p>
                          <ul className="list-disc pl-5 text-muted-foreground">
                            {result.tacticalPlan.concisePlan.slice(0, 4).map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {result.tacticalPlan.summary ? (
                        <p className="rounded-md border border-input p-3 font-medium">{result.tacticalPlan.summary}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                ) : null}

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Dynamic Match Schedule (3749)</CardTitle>
                    <CardDescription>Auto-refreshes every 30s for {eventKey}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-80 overflow-auto rounded-md border border-input">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-input text-left text-muted-foreground">
                            <th className="p-2">Match</th>
                            <th className="p-2">3749</th>
                            <th className="p-2">Red</th>
                            <th className="p-2">Blue</th>
                            <th className="p-2">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scheduleRows.map((row) => (
                            <tr key={row.matchKey} className="border-b border-input/50 align-top">
                              <td className="p-2">{row.matchKey}</td>
                              <td className="p-2">{row.alliance3749 || 'N/A'}</td>
                              <td className="p-2">{(row.redTeams || []).join(', ')}</td>
                              <td className="p-2">{(row.blueTeams || []).join(', ')}</td>
                              <td className="p-2">{row.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Pick Leaderboard</CardTitle>
                    <CardDescription>Best alliance partners ranked for Team {teamNumber} from live event stats</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-96 overflow-auto rounded-md border border-input">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-input text-left text-muted-foreground">
                            <th className="p-2">Rank</th>
                            <th className="p-2">Team</th>
                            <th className="p-2">Pick Score</th>
                            <th className="p-2">Capability</th>
                            <th className="p-2">Durability</th>
                            <th className="p-2">Fit</th>
                            <th className="p-2">Strongest Value</th>
                            <th className="p-2">Tags</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pickLeaderboard.map((row) => (
                            <tr key={row.teamNumber} className="border-b border-input/50 align-top">
                              <td className="p-2">{row.rank}</td>
                              <td className="p-2">{row.teamNumber}</td>
                              <td className="p-2 font-semibold">{Number(row.pickScore || 0).toFixed(1)}</td>
                              <td className="p-2">{Number(row.capabilityScore || 0).toFixed(1)}</td>
                              <td className="p-2">{Number(row.durabilityScore || 0).toFixed(1)}</td>
                              <td className="p-2">{Number(row.fitScore || 0).toFixed(1)}</td>
                              <td className="p-2">{row.strongestValue || 'Balanced profile'}</td>
                              <td className="p-2">{Array.isArray(row.tags) && row.tags.length ? row.tags.join(', ') : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-6 lg:grid-cols-2">
                  <Card className="border-border/80 bg-card/90">
                    <CardHeader>
                      <CardTitle className="text-base">Spider Chart · Team {teamNumber}</CardTitle>
                      <CardDescription>Auto, Teleop, Defense, Cycle, Reliability, Endgame</CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center">
                      <div className="rounded-xl border border-border/80 bg-background/50 p-2">
                        <SpiderChart stat={teamDetail?.stat} />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Robot Status</CardTitle>
                      <CardDescription>Disable/tip/foul trends from scouted reports</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-72 overflow-auto rounded-md border border-input">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-input text-left text-muted-foreground">
                              <th className="p-2">Team</th>
                              <th className="p-2">Disable%</th>
                              <th className="p-2">Tip%</th>
                              <th className="p-2">Avg Fouls</th>
                              <th className="p-2">Last Climb</th>
                            </tr>
                          </thead>
                          <tbody>
                            {robotStatus.map((row) => (
                              <tr key={row.teamNumber} className="border-b border-input/50">
                                <td className="p-2">{row.teamNumber}</td>
                                <td className="p-2">{(Number(row.disableRate || 0) * 100).toFixed(1)}</td>
                                <td className="p-2">{(Number(row.tipRate || 0) * 100).toFixed(1)}</td>
                                <td className="p-2">{Number(row.avgFouls || 0).toFixed(2)}</td>
                                <td className="p-2">{row.lastEndgame}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </section>

              <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Schedule Import</CardTitle>
                    <CardDescription>Paste schedule CSV/JSON here. Event key auto-updates when detected.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <textarea
                      className="min-h-64 w-full rounded-md border border-input bg-background p-3 text-sm"
                      value={schedulePasteText}
                      onChange={(e) => setSchedulePasteText(e.target.value)}
                      placeholder="Paste schedule CSV/JSON here"
                    />
                    <Button className="w-full" onClick={importScheduleFromPaste}>Import Schedule</Button>
                    {importMessage ? <p className="text-xs text-muted-foreground">{importMessage}</p> : null}
                  </CardContent>
                </Card>
              </aside>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end">
        {brickOpen ? (
          <Card className="mb-2 w-[min(92vw,380px)] border-border/80 bg-card/95 shadow-xl backdrop-blur">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-foreground" />
                  <CardTitle className="text-sm">Brick AI</CardTitle>
                </div>
                <Badge className="border border-input bg-background text-xs text-muted-foreground">Assistant</Badge>
              </div>
              <CardDescription>Ask team and matchup questions for {eventKey}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-h-64 space-y-2 overflow-auto rounded-md border border-input bg-background/50 p-2">
                {brickMessages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={`rounded-md p-2 text-xs ${message.role === 'user' ? 'bg-accent text-accent-foreground' : 'bg-card text-foreground'}`}
                  >
                    <p className="mb-1 font-semibold">{message.role === 'user' ? 'You' : 'Brick AI'}</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">{message.text}</p>
                  </div>
                ))}
                {brickLoading ? (
                  <div className="rounded-md bg-card p-2 text-xs text-foreground">
                    <p className="mb-1 font-semibold">Brick AI</p>
                    <p className="text-muted-foreground">Brick is typing{brickTypingDots}</p>
                  </div>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Input
                  value={brickInput}
                  onChange={(e) => setBrickInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      askBrickAi();
                    }
                  }}
                  placeholder="Ask about teams, defense, reliability..."
                />
                <Button className="gap-1" onClick={askBrickAi} disabled={brickLoading}>
                  <Send className="h-4 w-4" />
                  {brickLoading ? '...' : 'Send'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Button
          className="gap-2 rounded-full border border-input bg-card px-4 shadow-xl hover:bg-accent"
          onClick={() => setBrickOpen((open) => !open)}
        >
          {brickOpen ? <X className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
          {brickOpen ? 'Close Brick AI' : 'Brick AI'}
        </Button>
      </div>

      <footer className="mt-10 pb-3 text-center text-xs text-muted-foreground">
        Made by SanPranav © 2026
      </footer>
    </main>
  );
}
