import { useEffect, useRef } from 'react';
import type { Story } from '../types';

const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
  draft: { label: 'Draft', bg: 'bg-gray-100 dark:bg-gray-700/50', text: 'text-gray-600 dark:text-gray-300' },
  estimated: { label: 'Estimated', bg: 'bg-gray-100 dark:bg-gray-700/50', text: 'text-gray-600 dark:text-gray-300' },
  planned: { label: 'Planned', bg: 'bg-gray-100 dark:bg-gray-700/50', text: 'text-gray-600 dark:text-gray-300' },
  todo: { label: 'To Do', bg: 'bg-gray-100 dark:bg-gray-700/50', text: 'text-gray-600 dark:text-gray-300' },
  in_progress: { label: 'In Progress', bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300' },
  review: { label: 'Review', bg: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-700 dark:text-yellow-300' },
  qa: { label: 'QA', bg: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-700 dark:text-yellow-300' },
  qa_failed: { label: 'QA Failed', bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300' },
  pr_submitted: { label: 'PR Submitted', bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-700 dark:text-purple-300' },
  merged: { label: 'Merged', bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300' },
  done: { label: 'Done', bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300' },
};

function formatDate(iso?: string): string {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderAcceptanceCriteria(text: string) {
  const lines = text.split('\n').filter(l => l.trim());
  const isBulletList = lines.every(l => /^[\s]*[-*]\s/.test(l) || /^[\s]*\d+[.)]\s/.test(l));

  if (isBulletList) {
    return (
      <ul className="space-y-1.5">
        {lines.map((line, i) => {
          const clean = line.replace(/^[\s]*[-*]\s?/, '').replace(/^[\s]*\d+[.)]\s?/, '').trim();
          return (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <span className="mt-0.5 w-4 h-4 rounded border border-gray-300 dark:border-gray-600 flex-shrink-0 flex items-center justify-center">
                <span className="w-2 h-2 rounded-sm bg-transparent" />
              </span>
              <span>{clean}</span>
            </li>
          );
        })}
      </ul>
    );
  }

  return <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{text}</p>;
}

interface StoryDetailModalProps {
  story: Story;
  onClose: () => void;
}

export function StoryDetailModal({ story, onClose }: StoryDetailModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const cfg = statusConfig[story.status] ?? { label: story.status, bg: 'bg-gray-100 dark:bg-gray-700/50', text: 'text-gray-600 dark:text-gray-300' };

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="card rounded-xl shadow-2xl dark:shadow-black/40 w-full max-w-2xl max-h-[85vh] overflow-y-auto border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="sticky top-0 card border-b border-gray-100 dark:border-gray-700 px-6 py-4 flex items-start justify-between rounded-t-xl">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-gray-400 dark:text-gray-500">{story.id}</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                {cfg.label}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white leading-snug">{story.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="ml-4 p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover-card transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-6">
          {/* Meta row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {story.points != null && (
              <div>
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">Points</p>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{story.points}</p>
              </div>
            )}
            {story.complexityScore != null && (
              <div>
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">Complexity</p>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{story.complexityScore}</p>
              </div>
            )}
            {(story.assignee || story.assignedAgentId) && (
              <div>
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">Assigned to</p>
                <p className="text-sm text-gray-800 dark:text-gray-200">{story.assignee || story.assignedAgentId}</p>
              </div>
            )}
          </div>

          {/* Description */}
          {story.description && (
            <div>
              <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Description</h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{story.description}</p>
            </div>
          )}

          {/* Acceptance Criteria */}
          {story.acceptanceCriteria && (
            <div>
              <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Acceptance Criteria</h3>
              {renderAcceptanceCriteria(story.acceptanceCriteria)}
            </div>
          )}

          {/* Branch & PR */}
          {(story.branchName || story.prUrl) && (
            <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-2">
              {story.branchName && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide w-16">Branch</span>
                  <code className="text-xs card border rounded px-2 py-0.5 text-gray-700 dark:text-gray-300 font-mono">
                    {story.branchName}
                  </code>
                </div>
              )}
              {story.prUrl && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide w-16">PR</span>
                  <a
                    href={story.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-hive-600 dark:text-hive-400 hover:text-hive-700 dark:hover:text-hive-300 hover:underline"
                  >
                    {story.prUrl}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Timestamps */}
          {(story.createdAt || story.updatedAt) && (
            <div className="border-t border-gray-100 dark:border-gray-700 pt-4 flex flex-wrap gap-6 text-xs text-gray-400 dark:text-gray-500">
              {story.createdAt && <span>Created {formatDate(story.createdAt)}</span>}
              {story.updatedAt && <span>Updated {formatDate(story.updatedAt)}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
