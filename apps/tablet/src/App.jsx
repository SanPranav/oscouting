import { useState } from 'react';
import { Joystick, Save } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './components/ui/select';

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

function RatingSlider({ label, value, onChange }) {
  const filledPercent = ((Number(value) - 1) / 4) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm text-muted-foreground">{label}</label>
        <span className="rounded-md border border-input bg-card px-2 py-0.5 text-xs font-semibold text-foreground">{value}/5</span>
      </div>
      <input
        type="range"
        min="1"
        max="5"
        step="1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rating-slider h-11 w-full cursor-pointer rounded-xl border border-input px-3"
        style={{
          background: `linear-gradient(to right, hsl(var(--foreground)) 0%, hsl(var(--foreground)) ${filledPercent}%, hsl(var(--muted)) ${filledPercent}%, hsl(var(--muted)) 100%)`
        }}
      />
      <div className="flex justify-between px-1 text-[11px] text-muted-foreground">
        <span>1</span>
        <span>5</span>
      </div>
    </div>
  );
}

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
    <main className="mx-auto min-h-screen max-w-6xl space-y-6 p-4 sm:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Match Scouting Control Panel</CardTitle>
          <CardDescription>Track one robot per match and submit fast, structured observations.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-xs">
          <Badge className="border border-input bg-background text-foreground">Event {form.eventKey}</Badge>
          <Badge className="border border-input bg-background text-foreground">Pending Offline: {pendingCount}</Badge>
          <Badge className="border border-input bg-background text-foreground">Backend {API_BASE ? 'Configured' : 'Local default'}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Joystick className="h-5 w-5 text-foreground" />
            <Badge>Tablet Scouting</Badge>
          </div>
          <CardTitle>Team 3749 Tablet Scouting Form</CardTitle>
          <CardDescription>Fuel is intentionally not tracked in this form. 2485 fuel data is handled by scraper import.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="mb-2 flex flex-col gap-2 rounded-md border border-input p-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Offline pending reports: {pendingCount}</span>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={buildOfflinePayload}>Generate Offline Batch</Button>
              <Button type="button" variant="outline" onClick={downloadOfflinePayload}>Download JSON</Button>
              <Button type="button" variant="secondary" onClick={clearOfflinePayload}>Clear Queue</Button>
            </div>
          </div>

          <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Event Key</label><Input className="h-11" value={form.eventKey} onChange={(e) => setField('eventKey', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Your name</label><Input className="h-11" value={form.scoutName} onChange={(e) => setField('scoutName', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Match Num</label><Input className="h-11" type="number" value={form.matchNum} onChange={(e) => setField('matchNum', Number(e.target.value))} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Team Number You Are Scouting</label><Input className="h-11" type="number" value={form.teamNumber} onChange={(e) => setField('teamNumber', Number(e.target.value))} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Starting Position (1 left, 3 right)</label><Input className="h-11" value={form.startingPosition} onChange={(e) => setField('startingPosition', e.target.value)} placeholder="1/2/3" /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Describe The Auto Path</label><Input className="h-11" value={form.autoPath} onChange={(e) => setField('autoPath', e.target.value)} /></div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Did they cross center line for auto?</label>
              <Select value={form.crossedCenterLine} onValueChange={(value) => setField('crossedCenterLine', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="maybe">Maybe</SelectItem>
                  <SelectItem value="idk">IDK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Auto Climb</label>
              <Select value={form.autoClimb} onValueChange={(value) => setField('autoClimb', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select climb" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="l1">L1</SelectItem>
                  <SelectItem value="l2">L2</SelectItem>
                  <SelectItem value="l3">L3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">How many cycles</label><Input className="h-11" type="number" value={form.cycles} onChange={(e) => setField('cycles', Number(e.target.value))} /></div>
            <RatingSlider
              label="Cycle accuracy"
              value={form.cycleAccuracy}
              onChange={(value) => setField('cycleAccuracy', value)}
            />
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Addtional Cycle Notes</label><Input className="h-11" value={form.cycleNotes} onChange={(e) => setField('cycleNotes', e.target.value)} /></div>
            <RatingSlider
              label="Driving Behaviour"
              value={form.drivingBehavior}
              onChange={(value) => setField('drivingBehavior', value)}
            />
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Elaborate (Jerky, smooth etc.)</label><Input className="h-11" value={form.drivingBehaviorNotes} onChange={(e) => setField('drivingBehaviorNotes', e.target.value)} /></div>
            <RatingSlider
              label="Driving TEAM Behavior"
              value={form.drivingTeamBehavior}
              onChange={(value) => setField('drivingTeamBehavior', value)}
            />
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Driving TEAM Elaborate</label><Input className="h-11" value={form.drivingTeamBehaviorNotes} onChange={(e) => setField('drivingTeamBehaviorNotes', e.target.value)} /></div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Climb</label>
              <Select value={form.climb} onValueChange={(value) => setField('climb', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select climb" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="l1">L1</SelectItem>
                  <SelectItem value="l2">L2</SelectItem>
                  <SelectItem value="l3">L3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Ground Intake or Outpost Intake</label>
              <Select value={form.intakeType} onValueChange={(value) => setField('intakeType', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select intake" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ground">Ground</SelectItem>
                  <SelectItem value="outpost">Outpost</SelectItem>
                  <SelectItem value="idk">IDK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Are they using depot?</label>
              <Select value={form.usingDepot} onValueChange={(value) => setField('usingDepot', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="idk">IDK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Using Trench?</label>
              <Select value={form.usingTrench} onValueChange={(value) => setField('usingTrench', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="idk">IDK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Using Bump?</label>
              <Select value={form.usingBump} onValueChange={(value) => setField('usingBump', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="idk">IDK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Are they Passing?</label>
              <Select value={form.passing} onValueChange={(value) => setField('passing', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="idk">IDK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Things they did wrong (penalties)</label><Input className="h-11" value={form.penalties} onChange={(e) => setField('penalties', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Additional Notes?</label><Input className="h-11" value={form.additionalNotes} onChange={(e) => setField('additionalNotes', e.target.value)} /></div>
            <div className="sticky bottom-0 z-10 -mx-1 border-t border-input bg-background/95 p-2 backdrop-blur sm:col-span-2 lg:col-span-3">
              <Button variant="outline" type="submit" className="h-12 w-full gap-2 rounded-xl border-input bg-card text-base text-foreground shadow-none hover:bg-accent"><Save className="h-4 w-4" />Submit Match Report</Button>
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

      <footer className="pb-3 text-center text-xs text-muted-foreground">
        Made by SanPranav © 2026
      </footer>

    </main>
  );
}
