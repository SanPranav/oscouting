import { useEffect, useMemo, useState } from 'react';
import { Bot, Save } from 'lucide-react';
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
const EVENT_OPTIONS = [
  { value: '2026caasv', label: '2026caasv - Aerospace Valley' }
];
const DEFAULT_EVENT_KEY = '2026caasv';

const initial = {
  eventKey: '2026caasv',
  scoutName: '',
  teamNumber: 3749,
  hopperCapacity: 0,
  drivetrainType: 'swerve',
  swerveModuleType: '',
  swerveGearing: '',
  canUseTrench: 'yes',
  canCrossBump: 'yes',
  cycleBallsPerSecond: 0,
  cycleSpeed: 'medium',
  outpostCapability: 'yes',
  depotCapability: 'yes',
  intakeType: 'roller_ground',
  shooterType: 'flywheel',
  visionType: 'limelight',
  autoPaths: '',
  climberType: 'telescoping',
  climbCapability: 'deep',
  hasGroundIntake: 'yes',
  hasSourceIntake: 'yes',
  driveMotorType: 'kraken_x60',
  shooterMotorType: 'falcon_500',
  intakeMotorType: 'neo_550',
  climberMotorType: 'neo',
  softwareFeatures: '',
  mechanicalFeatures: '',
  mechanismNotes: ''
};

const toBoolFromYes = (value) => String(value || '').toLowerCase() === 'yes';

const buildPayloadFromForm = (form) => {
  return {
    eventKey: form.eventKey,
    scoutName: form.scoutName || 'unknown',
    teamNumber: Number(form.teamNumber),
    hopper_capacity: Number(form.hopperCapacity || 0),
    drivetrain_type: form.drivetrainType,
    swerve_module_type: form.swerveModuleType,
    swerve_gearing: form.swerveGearing,
    can_use_trench: toBoolFromYes(form.canUseTrench),
    can_cross_bump: toBoolFromYes(form.canCrossBump),
    cycle_balls_per_sec: Number(form.cycleBallsPerSecond),
    cycle_speed: form.cycleSpeed,
    outpost_capability: toBoolFromYes(form.outpostCapability),
    depot_capability: toBoolFromYes(form.depotCapability),
    intake_type: form.intakeType,
    shooter_type: form.shooterType,
    vision_type: form.visionType,
    auto_paths: form.autoPaths,
    climber_type: form.climberType,
    climb_capability: form.climbCapability,
    has_ground_intake: toBoolFromYes(form.hasGroundIntake),
    has_source_intake: toBoolFromYes(form.hasSourceIntake),
    drive_motor_type: form.driveMotorType,
    shooter_motor_type: form.shooterMotorType,
    intake_motor_type: form.intakeMotorType,
    climber_motor_type: form.climberMotorType,
    software_features: form.softwareFeatures,
    mechanical_features: form.mechanicalFeatures,
    mechanism_notes: form.mechanismNotes
  };
};

export default function App() {
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState('');
  const [offlinePayload, setOfflinePayload] = useState('');
  const [pendingCount, setPendingCount] = useState(() => {
    const raw = localStorage.getItem('pit-tablet-pending-reports');
    if (!raw) return 0;
    try {
      return JSON.parse(raw).length;
    } catch {
      return 0;
    }
  });

  const eventOptions = useMemo(() => {
    const currentKey = String(form.eventKey || '').trim();
    if (!currentKey || EVENT_OPTIONS.some((option) => option.value === currentKey)) return EVENT_OPTIONS;
    return [{ value: currentKey, label: `${currentKey} - Selected Competition` }, ...EVENT_OPTIONS];
  }, [form.eventKey]);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const syncSelectedCompetition = async (competition) => {
    const response = await fetch(`${API_BASE}/api/strategy/selected-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(competition)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.errorCode ? `${data.errorCode}: ${data.error || 'Failed saving competition'}` : (data.error || 'Failed saving competition'));
    }
    return data;
  };

  useEffect(() => {
    const loadSelectedCompetition = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/strategy/selected-event`);
        const data = await response.json();
        if (response.ok && data?.eventKey) {
          setField('eventKey', data.eventKey);
          return;
        }
        setMessage(data.errorCode ? `${data.errorCode}: ${data.error || 'Failed loading selected competition'}` : (data.error || 'Failed loading selected competition'));
      } catch {
        setMessage('E_SELECTED_EVENT_UNAVAILABLE: Failed loading selected competition');
      }
    };

    loadSelectedCompetition();
  }, []);

  const queueOffline = (payload) => {
    const raw = localStorage.getItem('pit-tablet-pending-reports');
    const current = raw ? JSON.parse(raw) : [];
    current.push(payload);
    localStorage.setItem('pit-tablet-pending-reports', JSON.stringify(current));
    setPendingCount(current.length);
    return current;
  };

  const submit = async (event) => {
    event.preventDefault();
    const payload = buildPayloadFromForm(form);

    try {
      setMessage('Submitting...');
      const response = await fetch(`${API_BASE}/api/scouting/pit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || 'Failed to submit');
        return;
      }

      setMessage(`Saved pit report #${data.report.id} (AI confidence ${Math.round((Number(data.ai?.confidence_score || 0) * 100))}%)`);
    } catch {
      queueOffline(payload);
      setMessage('No WiFi/backend. Pit report saved locally for offline transfer.');
    }
  };

  const buildOfflinePayload = () => {
    const raw = localStorage.getItem('pit-tablet-pending-reports');
    const current = raw ? JSON.parse(raw) : [];
    if (!current.length) {
      setMessage('No pending offline reports.');
      setOfflinePayload('');
      return;
    }

    setOfflinePayload(JSON.stringify({
      mode: 'pit',
      eventKey: form.eventKey,
      createdAt: new Date().toISOString(),
      reports: current
    }, null, 2));
    setMessage(`Offline pit batch ready (${current.length} reports). Download JSON and send to aggregator.`);
  };

  const downloadOfflinePayload = () => {
    const raw = localStorage.getItem('pit-tablet-pending-reports');
    const current = raw ? JSON.parse(raw) : [];
    if (!current.length) {
      setMessage('No pending offline reports to download.');
      return;
    }

    const exportData = {
      mode: 'pit',
      eventKey: form.eventKey,
      createdAt: new Date().toISOString(),
      reports: current
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const filename = `pit-scouting-offline-${form.eventKey}-${Date.now()}.json`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setMessage(`Downloaded ${filename}. Import this file in aggregator.`);
  };

  const clearOfflinePayload = () => {
    localStorage.removeItem('pit-tablet-pending-reports');
    setPendingCount(0);
    setOfflinePayload('');
    setMessage('Cleared local offline queue.');
  };

  return (
    <main className="mx-auto min-h-screen max-w-6xl space-y-6 p-4 sm:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pit Scouting Control Panel</CardTitle>
          <CardDescription>Capture robot build details and mechanism traits for pre-match strategy.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-xs">
          <Badge className="border border-input bg-background text-foreground">Event {form.eventKey}</Badge>
          <Badge className="border border-input bg-background text-foreground">Pending Offline: {pendingCount}</Badge>
          <Badge className="border border-input bg-background text-foreground">Backend {API_BASE ? 'Configured' : 'E_BACKEND_ENDPOINT_UNSET'}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Bot className="h-5 w-5 text-foreground" />
            <Badge>Pit Tablet</Badge>
          </div>
          <CardTitle>Team 3749 Pit Scouting Form</CardTitle>
          <CardDescription>Built for common FRC mechanisms with AI parsing for drivetrain, motor package, and strategic capability tags.</CardDescription>
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
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Event Key</label>
              <Select value={form.eventKey} onValueChange={async (value) => {
                setField('eventKey', value);
                try {
                  await syncSelectedCompetition({ eventKey: value, name: value });
                } catch {
                  // Keep the local selection even if the shared update fails.
                }
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select event" />
                </SelectTrigger>
                <SelectContent>
                  {eventOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Your name</label><Input className="h-11" value={form.scoutName} onChange={(e) => setField('scoutName', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Team Number</label><Input className="h-11" type="number" value={form.teamNumber} onChange={(e) => setField('teamNumber', Number(e.target.value))} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Hopper Capacity</label><Input className="h-11" type="number" min="0" value={form.hopperCapacity} onChange={(e) => setField('hopperCapacity', Number(e.target.value))} /></div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Drivetrain Type</label>
              <Select value={form.drivetrainType} onValueChange={(value) => setField('drivetrainType', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="swerve">Swerve</SelectItem>
                  <SelectItem value="tank">Tank / WCD</SelectItem>
                  <SelectItem value="mecanum">Mecanum</SelectItem>
                  <SelectItem value="h_drive">H-Drive</SelectItem>
                  <SelectItem value="x_drive">X-Drive</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Swerve Module Type</label><Input className="h-11" value={form.swerveModuleType} onChange={(e) => setField('swerveModuleType', e.target.value)} placeholder="MK4i, SDS L2, WCP X3" /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Swerve Gearing</label><Input className="h-11" value={form.swerveGearing} onChange={(e) => setField('swerveGearing', e.target.value)} placeholder="6.75:1, 8.14:1" /></div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Can Use Trench?</label>
              <Select value={form.canUseTrench} onValueChange={(value) => setField('canUseTrench', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Can Cross Bump?</label>
              <Select value={form.canCrossBump} onValueChange={(value) => setField('canCrossBump', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Balls Per Second</label><Input className="h-11" type="number" step="0.1" min="0" value={form.cycleBallsPerSecond} onChange={(e) => setField('cycleBallsPerSecond', Number(e.target.value))} /></div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Cycle Speed</label>
              <Select value={form.cycleSpeed} onValueChange={(value) => setField('cycleSpeed', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slow">Slow</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="fast">Fast</SelectItem>
                  <SelectItem value="elite">Elite</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Intake Type</label>
              <Select value={form.intakeType} onValueChange={(value) => setField('intakeType', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="roller_ground">Roller Ground</SelectItem>
                  <SelectItem value="outpost_station">Outpost / Source</SelectItem>
                  <SelectItem value="over_bumper">Over Bumper</SelectItem>
                  <SelectItem value="under_bumper">Under Bumper</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Outpost Capability</label>
              <Select value={form.outpostCapability} onValueChange={(value) => setField('outpostCapability', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Depot Capability</label>
              <Select value={form.depotCapability} onValueChange={(value) => setField('depotCapability', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Shooter Type</label>
              <Select value={form.shooterType} onValueChange={(value) => setField('shooterType', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flywheel">Flywheel</SelectItem>
                  <SelectItem value="pivoting_flywheel">Pivoting Flywheel</SelectItem>
                  <SelectItem value="drum">Drum</SelectItem>
                  <SelectItem value="catapult">Catapult</SelectItem>
                  <SelectItem value="puncher">Puncher</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Vision Type</label>
              <Select value={form.visionType} onValueChange={(value) => setField('visionType', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="limelight">Limelight</SelectItem>
                  <SelectItem value="photonvision">PhotonVision</SelectItem>
                  <SelectItem value="apriltag">AprilTag Pipeline</SelectItem>
                  <SelectItem value="pixy">Pixy</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Auto Paths</label><Input className="h-11" value={form.autoPaths} onChange={(e) => setField('autoPaths', e.target.value)} placeholder="2-piece center, 3-piece bump" /></div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Climber Type</label>
              <Select value={form.climberType} onValueChange={(value) => setField('climberType', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="telescoping">Telescoping</SelectItem>
                  <SelectItem value="hook">Hook / Single Arm</SelectItem>
                  <SelectItem value="multi_stage">Multi-stage</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Climb Capability</label>
              <Select value={form.climbCapability} onValueChange={(value) => setField('climbCapability', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deep">Deep</SelectItem>
                  <SelectItem value="shallow">Shallow</SelectItem>
                  <SelectItem value="park">Park</SelectItem>
                  <SelectItem value="assisted">Assisted</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Ground Intake</label>
              <Select value={form.hasGroundIntake} onValueChange={(value) => setField('hasGroundIntake', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Source Intake Available?</label>
              <Select value={form.hasSourceIntake} onValueChange={(value) => setField('hasSourceIntake', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Drive Motor Type</label><Input className="h-11" value={form.driveMotorType} onChange={(e) => setField('driveMotorType', e.target.value)} placeholder="kraken_x60, falcon_500, neo" /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Shooter Motor Type</label><Input className="h-11" value={form.shooterMotorType} onChange={(e) => setField('shooterMotorType', e.target.value)} placeholder="falcon_500, neo, cim" /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Intake Motor Type</label><Input className="h-11" value={form.intakeMotorType} onChange={(e) => setField('intakeMotorType', e.target.value)} placeholder="neo_550, bag" /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Climber Motor Type</label><Input className="h-11" value={form.climberMotorType} onChange={(e) => setField('climberMotorType', e.target.value)} placeholder="neo, falcon_500" /></div>
            <div className="space-y-2 sm:col-span-2 lg:col-span-3"><label className="text-sm text-muted-foreground">Any Interesting Software Features</label><Input className="h-11" value={form.softwareFeatures} onChange={(e) => setField('softwareFeatures', e.target.value)} placeholder="Auto-aim lock, dynamic path planner, odometry fusion" /></div>
            <div className="space-y-2 sm:col-span-2 lg:col-span-3"><label className="text-sm text-muted-foreground">Any Interesting Mechanical Features</label><Input className="h-11" value={form.mechanicalFeatures} onChange={(e) => setField('mechanicalFeatures', e.target.value)} placeholder="Telescoping hood, passive indexer, active suspension" /></div>
            <div className="space-y-2 sm:col-span-2 lg:col-span-3"><label className="text-sm text-muted-foreground">Mechanism Notes</label><Input className="h-11" value={form.mechanismNotes} onChange={(e) => setField('mechanismNotes', e.target.value)} placeholder="Write freeform mechanism notes for AI parsing" /></div>
            <div className="sticky bottom-0 z-10 -mx-1 border-t border-input bg-background/95 p-2 backdrop-blur sm:col-span-2 lg:col-span-3">
              <Button variant="outline" type="submit" className="h-12 w-full gap-2 rounded-xl border-input bg-card text-base text-foreground shadow-none hover:bg-accent"><Save className="h-4 w-4" />Submit Pit Report</Button>
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
