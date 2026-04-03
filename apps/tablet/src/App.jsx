import { useEffect, useMemo, useState } from 'react';
import { Bot, Joystick, LayoutGrid } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Badge } from './components/ui/badge';
import MatchTabletPage from './MatchTabletPage.jsx';
import PitTabletPage from '../../pit-tablet/src/App.jsx';

const ROOT_PATH = '/';
const MATCH_PATH = '/match-tablet';
const PIT_PATH = '/pit-tablet';

function normalizePath(pathname) {
  if (!pathname) return ROOT_PATH;
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

function Launcher({ onNavigate }) {
  return (
    <main className="mx-auto min-h-screen max-w-4xl space-y-6 p-4 sm:p-6">
      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-foreground" />
            <Badge>Scouting Home</Badge>
          </div>
          <CardTitle>Choose Scouting Mode</CardTitle>
          <CardDescription>
            Open match scouting or pit scouting from one main page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="h-12 w-full justify-start gap-2" onClick={() => onNavigate(MATCH_PATH)}>
            <Joystick className="h-4 w-4" />
            Match Scouting Tablet
          </Button>
          <Button variant="secondary" className="h-12 w-full justify-start gap-2" onClick={() => onNavigate(PIT_PATH)}>
            <Bot className="h-4 w-4" />
            Pit Scouting Tablet
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

export default function App() {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (nextPath) => {
    const normalized = normalizePath(nextPath);
    if (normalizePath(window.location.pathname) !== normalized) {
      window.history.pushState({}, '', normalized);
    }
    setPath(normalized);
  };

  const content = useMemo(() => {
    if (path === MATCH_PATH) return <MatchTabletPage />;
    if (path === PIT_PATH) return <PitTabletPage />;
    return <Launcher onNavigate={navigate} />;
  }, [path]);

  return content;
}
