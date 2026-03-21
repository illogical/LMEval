import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, GitCompare, Clock, Zap, BarChart2 } from 'lucide-react';
import { listSessions } from '../api/eval';
import type { SessionManifest } from '../types/session';
import './SessionHubPage.css';

export function SessionHubPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionManifest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="hub-page">
      <div className="hub-content">
        <div className="hub-hero">
          <h1 className="hub-title">LMEval</h1>
          <p className="hub-subtitle">Evaluate and compare language model prompts at scale</p>
          <div className="hub-actions">
            <button className="hub-cta hub-cta-primary" onClick={() => navigate('/eval/prompts')}>
              <Plus size={16} />
              New Evaluation
            </button>
            <button className="hub-cta hub-cta-secondary" onClick={() => navigate('/compare')}>
              <GitCompare size={16} />
              Quick Compare
            </button>
          </div>
        </div>

        <div className="hub-features">
          <div className="hub-feature">
            <Zap size={24} className="hub-feature-icon" />
            <h3>Multi-Model Eval</h3>
            <p>Run prompts against multiple models simultaneously</p>
          </div>
          <div className="hub-feature">
            <BarChart2 size={24} className="hub-feature-icon" />
            <h3>Smart Scoring</h3>
            <p>AI-powered judge scoring with custom perspectives</p>
          </div>
          <div className="hub-feature">
            <Clock size={24} className="hub-feature-icon" />
            <h3>Track Progress</h3>
            <p>Version prompts and track improvements over time</p>
          </div>
        </div>

        {!loading && sessions.length > 0 && (
          <div className="hub-sessions">
            <h2 className="hub-sessions-title">Recent Sessions</h2>
            <div className="hub-session-grid">
              {sessions.slice(0, 6).map(session => (
                <div
                  key={session.id}
                  className="hub-session-card"
                  onClick={() => navigate('/eval/prompts')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && navigate('/eval/prompts')}
                >
                  <div className="hsc-name">{session.name}</div>
                  {session.description && <div className="hsc-desc">{session.description}</div>}
                  <div className="hsc-meta">
                    <Clock size={12} />
                    <span>{new Date(session.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="hub-loading">Loading sessions…</div>
        )}
      </div>
    </div>
  );
}
