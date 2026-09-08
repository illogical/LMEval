import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tags, FileText, ScrollText, FilePlus, ArrowLeft, BarChart2 } from 'lucide-react';
import { listPurposeTemplates } from '../api/eval';
import { applyPurposeTemplateToStorage } from '../contexts/purposeTemplateStorage';
import type { EvalPurposeTemplate, PurposeCategory } from '../types/eval';
import './TemplateGalleryPage.css';

const CATEGORY_ICON: Record<PurposeCategory, React.ComponentType<{ size?: number }>> = {
  classification: FileText,
  tagging: Tags,
  summarization: ScrollText,
  custom: FilePlus,
};

export function TemplateGalleryPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<EvalPurposeTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listPurposeTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, []);

  function selectTemplate(template: EvalPurposeTemplate) {
    applyPurposeTemplateToStorage(template);
    navigate('/eval/prompts');
  }

  const builtIns = templates.filter(t => t.builtIn);
  const custom = templates.filter(t => !t.builtIn);

  return (
    <div className="tg-page">
      <div className="tg-content">
        <button className="tg-back" onClick={() => navigate('/')}>
          <ArrowLeft size={14} /> Session Hub
        </button>

        <div className="tg-hero">
          <h1 className="tg-title">New Evaluation</h1>
          <p className="tg-subtitle">Start from a purpose template, or build your own from scratch</p>
        </div>

        {loading && <div className="tg-loading">Loading templates…</div>}

        {!loading && (
          <div className="tg-grid">
            <div
              className="tg-card tg-card--guided"
              onClick={() => navigate('/campaigns/new')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && navigate('/campaigns/new')}
            >
              <BarChart2 size={22} />
              <div className="tg-card-name">Guided Model Selection</div>
              <div className="tg-card-desc">Refine a prompt, compare candidate models, and confirm a defensible recommendation</div>
              <div className="tg-card-badge">Multi-phase</div>
            </div>
            {[...builtIns, ...custom].map(template => {
              const Icon = CATEGORY_ICON[template.purposeCategory];
              return (
                <div
                  key={template.id}
                  className="tg-card"
                  onClick={() => selectTemplate(template)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && selectTemplate(template)}
                >
                  <Icon size={22} />
                  <div className="tg-card-name">{template.name}</div>
                  <div className="tg-card-desc">{template.description}</div>
                  {!template.builtIn && <div className="tg-card-badge">Custom</div>}
                </div>
              );
            })}

            <div
              className="tg-card tg-card--blank"
              onClick={() => navigate('/eval/prompts')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && navigate('/eval/prompts')}
            >
              <FilePlus size={22} />
              <div className="tg-card-name">Start Blank</div>
              <div className="tg-card-desc">Build an evaluation from scratch, no starter content</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
