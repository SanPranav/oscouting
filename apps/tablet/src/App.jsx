import { useState } from 'react';
import { Joystick, Save } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';

const API_BASE = import.meta.env.VITE_API_BASE || '';

const initial = {
  eventKey: '2026casnd',
  scoutName: '',
  matchNum: 1,
  teamNumber: 3749,
  startingPosition: '2',
  autoPath: '',
  crossedCenterLine: 'maybe',
  autoClimb: 'none',
  cycles: 0,
  cycleAccuracy: 3,
  cycleNotes: '',
  drivingBehavior: 3,
  drivingBehaviorNotes: '',
  drivingTeamBehavior: 3,
  drivingTeamBehaviorNotes: '',
  climb: 'none',
  intakeType: 'idk',
  usingDepot: 'idk',
  usingTrench: 'idk',
  usingBump: 'idk',
  passing: 'idk',
  penalties: '',
  additionalNotes: ''
};

const parseClimb = (value) => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'l1') return 'level1';
  if (normalized === 'l2') return 'level2';
  if (normalized === 'l3') return 'level3';
  return 'none';
};

const parsePenaltyCount = (value) => {
  const found = String(value || '').match(/\d+/)?.[0];
  return found ? Number(found) : 0;
};

const toBoolFromYes = (value) => String(value || '').toLowerCase() === 'yes';

const buildPayloadFromForm = (form) => {
  const generalNotes = [
    `starting_position=${form.startingPosition}`,
    `auto_path=${form.autoPath}`,
    `crossed_center_line=${form.crossedCenterLine}`,
    `cycle_accuracy=${form.cycleAccuracy}`,
    `cycle_notes=${form.cycleNotes}`,
    `driving_behavior=${form.drivingBehavior}`,
    `driving_behavior_notes=${form.drivingBehaviorNotes}`,
    `driving_team_behavior=${form.drivingTeamBehavior}`,
    `driving_team_behavior_notes=${form.drivingTeamBehaviorNotes}`,
    `intake_type=${form.intakeType}`,
    `using_depot=${form.usingDepot}`,
    `passing=${form.passing}`,
    `penalties=${form.penalties}`,
    `additional_notes=${form.additionalNotes}`
  ].filter(Boolean).join(' | ');

  return {
    eventKey: form.eventKey,
    scoutName: form.scoutName || 'unknown',
    team_number: Number(form.teamNumber),
    match_number: Number(form.matchNum),
    alliance_color: 'red',
    auto_fuel_auto: 0,
    auto_fuel_missed: 0,
    auto_tower_climb: parseClimb(form.autoClimb) === 'none' ? 0 : 1,
    auto_mobility: form.crossedCenterLine !== 'no',
    auto_hub_shift_won: false,
    teleop_fuel_scored: 0,
    teleop_fuel_missed: 0,
    teleop_defense_rating: Number(form.drivingTeamBehavior),
    teleop_speed_rating: Number(form.drivingBehavior),
    teleop_crossed_bump: toBoolFromYes(form.usingBump),
    teleop_crossed_trench: toBoolFromYes(form.usingTrench),
    endgame_result: parseClimb(form.climb),
    endgame_attempted_climb: parseClimb(form.climb) !== 'none',
    robot_disabled: false,
    robot_tipped: false,
    fouls_committed: parsePenaltyCount(form.penalties),
    general_notes: generalNotes
  };
};

export default function App() {
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState('');
  const [offlinePayload, setOfflinePayload] = useState('');
  const [pendingCount, setPendingCount] = useState(() => {
    const raw = localStorage.getItem('tablet-pending-reports');
    if (!raw) return 0;
    try {
      return JSON.parse(raw).length;
    } catch {
      return 0;
    }
  });

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const queueOffline = (payload) => {
    const raw = localStorage.getItem('tablet-pending-reports');
    const current = raw ? JSON.parse(raw) : [];
    current.push(payload);
    localStorage.setItem('tablet-pending-reports', JSON.stringify(current));
    setPendingCount(current.length);
    return current;
  };

  const submit = async (event) => {
    event.preventDefault();
    const payload = buildPayloadFromForm(form);

    try {
      setMessage('Submitting...');
      const response = await fetch(`${API_BASE}/api/scouting/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || 'Failed to submit');
        return;
      }

      setMessage(`Saved report #${data.report.id} (confidence ${data.ai.confidence_score})`);
    } catch {
      queueOffline(payload);
      setMessage('No WiFi/backend. Report saved locally for offline transfer.');
    }
  };

  const buildOfflinePayload = () => {
    const raw = localStorage.getItem('tablet-pending-reports');
    const current = raw ? JSON.parse(raw) : [];
    if (!current.length) {
      setMessage('No pending offline reports.');
      setOfflinePayload('');
      return;
    }

    setOfflinePayload(JSON.stringify({
      eventKey: form.eventKey,
      createdAt: new Date().toISOString(),
      reports: current
    }, null, 2));
    setMessage(`Offline batch ready (${current.length} reports). Download JSON and DM it.`);
  };

  const downloadOfflinePayload = () => {
    const raw = localStorage.getItem('tablet-pending-reports');
    const current = raw ? JSON.parse(raw) : [];
    if (!current.length) {
      setMessage('No pending offline reports to download.');
      return;
    }

    const exportData = {
      eventKey: form.eventKey,
      createdAt: new Date().toISOString(),
      reports: current
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const filename = `scouting-offline-${form.eventKey}-${Date.now()}.json`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setMessage(`Downloaded ${filename}. Send this file to your aggregator laptop.`);
  };

  const clearOfflinePayload = () => {
    localStorage.removeItem('tablet-pending-reports');
    setPendingCount(0);
    setOfflinePayload('');
    setMessage('Cleared local offline queue.');
  };

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6">
      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Joystick className="h-5 w-5 text-primary" />
            <Badge>Tablet Scouting</Badge>
          </div>
          <CardTitle>Team 3749 Tablet Scouting Form</CardTitle>
          <CardDescription>Fuel is intentionally not tracked in this form. 2485 fuel data is handled by scraper import.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center justify-between rounded-md border border-input p-3 text-sm text-muted-foreground">
            <span>Offline pending reports: {pendingCount}</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={buildOfflinePayload}>Generate Offline Batch</Button>
              <Button type="button" variant="outline" onClick={downloadOfflinePayload}>Download JSON</Button>
              <Button type="button" variant="secondary" onClick={clearOfflinePayload}>Clear Queue</Button>
            </div>
          </div>

          <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Event Key</label><Input value={form.eventKey} onChange={(e) => setField('eventKey', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Your name</label><Input value={form.scoutName} onChange={(e) => setField('scoutName', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Match Num</label><Input type="number" value={form.matchNum} onChange={(e) => setField('matchNum', Number(e.target.value))} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Team Number You Are Scouting</label><Input type="number" value={form.teamNumber} onChange={(e) => setField('teamNumber', Number(e.target.value))} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Starting Position (1 left, 3 right)</label><Input value={form.startingPosition} onChange={(e) => setField('startingPosition', e.target.value)} placeholder="1/2/3" /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Describe The Auto Path</label><Input value={form.autoPath} onChange={(e) => setField('autoPath', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Did they cross center line for auto? (yes/no/maybe)</label><Input value={form.crossedCenterLine} onChange={(e) => setField('crossedCenterLine', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Auto Climb (none/l1/l2/l3)</label><Input value={form.autoClimb} onChange={(e) => setField('autoClimb', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">How many cycles</label><Input type="number" value={form.cycles} onChange={(e) => setField('cycles', Number(e.target.value))} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Cycle accuracy (1-5)</label><Input type="number" min="1" max="5" value={form.cycleAccuracy} onChange={(e) => setField('cycleAccuracy', Number(e.target.value))} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Addtional Cycle Notes</label><Input value={form.cycleNotes} onChange={(e) => setField('cycleNotes', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Driving Behaviour (1-5)</label><Input type="number" min="1" max="5" value={form.drivingBehavior} onChange={(e) => setField('drivingBehavior', Number(e.target.value))} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Elaborate (Jerky, smooth etc.)</label><Input value={form.drivingBehaviorNotes} onChange={(e) => setField('drivingBehaviorNotes', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Driving TEAM Behavior (1-5)</label><Input type="number" min="1" max="5" value={form.drivingTeamBehavior} onChange={(e) => setField('drivingTeamBehavior', Number(e.target.value))} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Driving TEAM Elaborate</label><Input value={form.drivingTeamBehaviorNotes} onChange={(e) => setField('drivingTeamBehaviorNotes', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Climb (none/l1/l2/l3)</label><Input value={form.climb} onChange={(e) => setField('climb', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Ground Intake or Outpost Intake (ground/outpost/idk)</label><Input value={form.intakeType} onChange={(e) => setField('intakeType', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Are they using depot (yes/no/idk)</label><Input value={form.usingDepot} onChange={(e) => setField('usingDepot', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Using Trench? (yes/no/idk)</label><Input value={form.usingTrench} onChange={(e) => setField('usingTrench', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Using Bump? (yes/no/idk)</label><Input value={form.usingBump} onChange={(e) => setField('usingBump', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Are they Passing? (yes/no/idk)</label><Input value={form.passing} onChange={(e) => setField('passing', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Things they did wrong (penalties)</label><Input value={form.penalties} onChange={(e) => setField('penalties', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Additional Notes?</label><Input value={form.additionalNotes} onChange={(e) => setField('additionalNotes', e.target.value)} /></div>
            <div className="md:col-span-2">
              <Button type="submit" className="w-full gap-2"><Save className="h-4 w-4" />Submit Match Report</Button>
            </div>
          </form>

          {offlinePayload ? (
            <div className="mt-4 space-y-2">
              <label className="text-sm text-muted-foreground">Offline Batch Payload (copy this)</label>
              <textarea className="min-h-32 w-full rounded-md border border-input bg-background p-3 text-xs" value={offlinePayload} readOnly />
            </div>
          ) : null}

          {message ? <p className="mt-4 text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
