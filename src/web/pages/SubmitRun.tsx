import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { RepoSearch } from '../components/RepoSearch';

const MODEL_OPTIONS = ['Claude Opus 4.6', 'Claude Sonnet 4.6', 'Claude Haiku 4.5'];
const SIZE_TIERS = [
  { value: 'small', label: 'Small (2 vCPU, 8GB)' },
  { value: 'medium', label: 'Medium (4 vCPU, 16GB)' },
  { value: 'large', label: 'Large (8 vCPU, 32GB)' },
];

export function SubmitRun() {
  const navigate = useNavigate();
  const { post } = useApi();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [repositories, setRepositories] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [model, setModel] = useState(MODEL_OPTIONS[0]!);
  const [sizeTier, setSizeTier] = useState('medium');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const data = await post<{ id: string }>('/api/runs', {
        title, description,
        repositories: repositories.filter(Boolean),
        model, sizeTier,
      });
      navigate(`/run/${data.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 card-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-hive-500 focus:border-transparent transition-colors';

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-heading mb-1">New Run</h1>
      <p className="text-sm text-secondary mb-6">Submit a requirement for the hive to implement</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-label mb-1.5">
            Requirement Title
          </label>
          <input
            id="title" type="text" value={title}
            onChange={e => setTitle(e.target.value)} required
            className={inputCls}
            placeholder="Add user authentication with OAuth2"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-label mb-1.5">
            Description
          </label>
          <textarea
            id="description" value={description}
            onChange={e => setDescription(e.target.value)} rows={4}
            className={inputCls}
            placeholder="Describe the requirements in detail..."
          />
        </div>

        <RepoSearch selected={repositories} onSelect={setRepositories} />

        <div>
          <button
            type="button" onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-secondary hover:text-heading font-medium transition-colors"
          >
            {showAdvanced ? 'Hide' : 'Show'} Advanced Options
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-4 p-4 card rounded-lg border">
              <div>
                <label htmlFor="model" className="block text-sm font-medium text-label mb-1.5">Model</label>
                <select id="model" value={model} onChange={e => setModel(e.target.value)} className={inputCls}>
                  {MODEL_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="size" className="block text-sm font-medium text-label mb-1.5">Size Tier</label>
                <select id="size" value={sizeTier} onChange={e => setSizeTier(e.target.value)} className={inputCls}>
                  {SIZE_TIERS.map(tier => <option key={tier.value} value={tier.value}>{tier.label}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        <button
          type="submit" disabled={submitting || !title}
          className="w-full px-4 py-2.5 bg-hive-600 text-white rounded-lg hover:bg-hive-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium shadow-sm"
        >
          {submitting ? 'Submitting...' : 'Submit Run'}
        </button>
      </form>
    </div>
  );
}
