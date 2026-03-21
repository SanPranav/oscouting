import { useState } from 'react';
import { Radar, Sparkles } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';

const API_BASE = import.meta.env.VITE_API_BASE || '';

function SpiderChart({ stat }) {
  if (!stat) return null;

  const metrics = [
    Number(stat.spiderAuto || 0),
    Number(stat.spiderTeleop || 0),
    Number(stat.spiderDefense || 0),
    Number(stat.spiderCycleSpeed || 0),
    Number(stat.spiderReliability || 0),
    Number(stat.spiderEndgame || 0)
  ];

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
        <line x1={cx} y1={cy} x2={x} y2={y} stroke="currentColor" opacity="0.2" />
        <text x={lx} y={ly} fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.8">{label}</text>
      </g>
    );
  });

  return (
    <svg viewBox="0 0 240 240" className="h-64 w-64 text-primary">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" opacity="0.15" />
      <circle cx={cx} cy={cy} r={r * 0.66} fill="none" stroke="currentColor" opacity="0.1" />
      <circle cx={cx} cy={cy} r={r * 0.33} fill="none" stroke="currentColor" opacity="0.08" />
      {axis}
      <polygon points={points} fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="2" />
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
  const [error, setError] = useState('');

  const runPrediction = async () => {
    try {
      setError('');
      const response = await fetch(`${API_BASE}/api/strategy/predict/${eventKey}/${matchKey}`);
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Prediction failed');
        setResult(null);
        return;
      }
      setResult(data);
    } catch {
      setError('Server unreachable. Start backend on http://localhost:2540.');
      setResult(null);
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

  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-6 p-6">
      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            <Badge>Drive Dashboard</Badge>
          </div>
          <CardTitle>Match Prediction</CardTitle>
          <CardDescription>Use local scouting stats plus AI narrative for strategy calls.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Input value={eventKey} onChange={(e) => setEventKey(e.target.value)} placeholder="event key" />
            <Input value={matchKey} onChange={(e) => setMatchKey(e.target.value)} placeholder="match id (5, qm5, or 2026casnd_qm5)" />
            <Button className="gap-2" onClick={runPrediction}><Sparkles className="h-4 w-4" />Predict Match</Button>
            <Input value={teamNumber} onChange={(e) => setTeamNumber(e.target.value)} placeholder="team for spider/status" />
          </div>
          <Button variant="outline" onClick={loadTeamPanels}>Load Spider + Robot Status</Button>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {result ? (
            <Card className="border-primary/40">
              <CardHeader>
                <CardTitle className="text-base">{result.matchKey}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Red: <span className="font-semibold">{result.redPredicted}</span> | Blue: <span className="font-semibold">{result.bluePredicted}</span></p>
                <p>Confidence: {result.confidence}</p>
                <p className="text-muted-foreground">{result.narrative}</p>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Spider Chart · Team {teamNumber}</CardTitle>
                <CardDescription>Auto, Teleop, Defense, Cycle, Reliability, Endgame</CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center">
                <SpiderChart stat={teamDetail?.stat} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Robot Status</CardTitle>
                <CardDescription>Disable/tip/foul trends from scouted reports</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-64 overflow-auto rounded-md border border-input">
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
        </CardContent>
      </Card>
    </main>
  );
}
