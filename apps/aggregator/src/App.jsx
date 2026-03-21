import { useEffect, useState } from 'react';
import { Database, FileUp, Upload } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';

const API_BASE = import.meta.env.VITE_API_BASE || '';

export default function App() {
  const [eventKey, setEventKey] = useState('2026casnd');
  const [matchKey, setMatchKey] = useState('qm24');
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [predictionMessage, setPredictionMessage] = useState('');

  const load = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/strategy/stats/${eventKey}`);
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || 'Failed loading stats');
        return;
      }
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setMessage('Server unreachable. Start backend on http://localhost:2540.');
    }
  };

  const scrape = async () => {
    try {
      setMessage('Scraping 2485...');
      const response = await fetch(`${API_BASE}/api/sync/scrape/${eventKey}`, { method: 'POST' });
      const data = await response.json();
      setMessage(response.ok ? `Imported ${data.count} rows` : data.error || 'Scrape failed');
    } catch {
      setMessage('Server unreachable. Start backend on http://localhost:2540.');
    }
  };

  const scrapeAll = async () => {
    try {
      setMessage('Scraping all 2485 rows...');
      const response = await fetch(`${API_BASE}/api/sync/scrape-all`, { method: 'POST' });
      const data = await response.json();
      setMessage(response.ok ? `Global scrape imported ${data.count} rows into ${data.eventKey}` : data.error || 'Scrape-all failed');
    } catch {
      setMessage('Server unreachable. Start backend on http://localhost:2540.');
    }
  };

  const importPaste = async () => {
    try {
      setMessage('Importing pasted data...');
      const response = await fetch(`${API_BASE}/api/import/paste`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventKey, text: pasteText, type: 'auto' })
      });

      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || 'Paste import failed');
        return;
      }

      if (data.imported !== undefined) {
        setMessage(`Imported ${data.imported} scouting rows${data.errors?.length ? ` (${data.errors.length} row errors)` : ''}`);
      } else if (data.importedMatches !== undefined) {
        setMessage(`Imported ${data.importedMatches} matches from ${data.type}`);
      } else if (data.importedTeams !== undefined) {
        setMessage(`Imported ${data.importedTeams} team OPR rows`);
      } else {
        setMessage('Import completed');
      }

      await load();
    } catch {
      setMessage('Server unreachable. Start backend on http://localhost:2540.');
    }
  };

  const importScheduleAndPredict = async () => {
    try {
      setPredictionMessage('Importing schedule and predicting...');
      const response = await fetch(`${API_BASE}/api/import/paste`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventKey, text: pasteText, type: 'auto' })
      });

      const imported = await response.json();
      if (!response.ok) {
        setPredictionMessage(imported.error || 'Import failed before prediction');
        return;
      }

      const predictResponse = await fetch(`${API_BASE}/api/strategy/predict/${eventKey}/${matchKey}`);
      const prediction = await predictResponse.json();
      if (!predictResponse.ok) {
        setPredictionMessage(prediction.error || 'Prediction failed after import');
        return;
      }

      setPredictionMessage(
        `Pred ${prediction.matchKey}: Red ${prediction.redPredicted} | Blue ${prediction.bluePredicted} (${prediction.confidence})`
      );
      await load();
    } catch {
      setPredictionMessage('Server unreachable. Start backend on http://localhost:2540.');
    }
  };

  const importOfflineBatch = async () => {
    try {
      const parsed = JSON.parse(pasteText);

      if (!parsed || !Array.isArray(parsed.reports)) {
        setMessage('Offline JSON must include a reports array.');
        return;
      }

      const response = await fetch(`${API_BASE}/api/import/offline-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });

      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || 'Offline batch import failed');
        return;
      }

      setMessage(`Imported ${data.imported} offline tablet reports`);
      await load();
    } catch {
      setMessage('Invalid offline JSON payload');
    }
  };

  const importOfflineFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      setPasteText(text);
      const parsed = JSON.parse(text);

      if (!parsed || !Array.isArray(parsed.reports)) {
        setMessage('Selected file is not a valid offline batch JSON (missing reports).');
        return;
      }

      const response = await fetch(`${API_BASE}/api/import/offline-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });

      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || 'Offline batch import failed');
        return;
      }

      setMessage(`Imported ${data.imported} offline tablet reports from ${file.name}`);
      await load();
    } catch {
      setMessage('Could not read JSON file.');
    } finally {
      event.target.value = '';
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-6xl space-y-6 p-6">
      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <Badge>Aggregator</Badge>
          </div>
          <CardTitle>Event Aggregation Console</CardTitle>
          <CardDescription>Paste your match schedule (CSV) in the box below and click AI Import Paste. You can also paste flat schedule, OPRs, scouting CSV, or offline tablet JSON.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={eventKey} onChange={(e) => setEventKey(e.target.value)} placeholder="event key (e.g. 2026casnd)" />
            <Input value={matchKey} onChange={(e) => setMatchKey(e.target.value)} placeholder="match (e.g. qm24 or 24)" />
            <Button onClick={load}>Load Stats</Button>
            <Button variant="secondary" onClick={scrape}>Scrape 2485</Button>
            <Button variant="outline" onClick={scrapeAll}>Scrape All 2485</Button>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Paste schedule, flat schedule, component OPRs, scouting CSV, or offline tablet JSON</label>
            <textarea
              className="min-h-36 w-full rounded-md border border-input bg-background p-3 text-sm"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste CSV or offline JSON payload here"
            />
            <div className="flex flex-wrap gap-2">
              <Button className="gap-2" onClick={importPaste}><Upload className="h-4 w-4" />AI Import Paste</Button>
              <Button variant="secondary" onClick={importScheduleAndPredict}>Import Schedule + Predict Match</Button>
              <Button variant="outline" onClick={importOfflineBatch}>Import Offline Tablet Batch</Button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                <FileUp className="h-4 w-4" />
                Import Offline JSON File
                <input type="file" accept="application/json,.json" className="hidden" onChange={importOfflineFile} />
              </label>
            </div>
          </div>

          {predictionMessage ? <p className="text-sm text-muted-foreground">{predictionMessage}</p> : null}

          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead>Matches</TableHead>
                <TableHead>Auto</TableHead>
                <TableHead>Teleop</TableHead>
                <TableHead>Reliability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.eventKey}-${row.teamNumber}`}>
                  <TableCell>{row.teamNumber}</TableCell>
                  <TableCell>{row.matchesScouted}</TableCell>
                  <TableCell>{Number(row.spiderAuto || 0).toFixed(1)}</TableCell>
                  <TableCell>{Number(row.spiderTeleop || 0).toFixed(1)}</TableCell>
                  <TableCell>{Number(row.spiderReliability || 0).toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
