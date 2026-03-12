import { useState } from 'react';
import type { Story, StoryStatus } from '../types';
import { StoryDetailModal } from './StoryDetailModal';

interface KanbanColumn {
  key: string;
  label: string;
  statuses: StoryStatus[];
  headerColor: string;
  borderColor: string;
  badgeBg: string;
  badgeText: string;
}

const columns: KanbanColumn[] = [
  {
    key: 'todo',
    label: 'To Do',
    statuses: ['draft', 'estimated', 'planned', 'todo'],
    headerColor: 'text-gray-700 dark:text-gray-300',
    borderColor: 'border-l-gray-400 dark:border-l-gray-500',
    badgeBg: 'bg-gray-100 dark:bg-gray-700/50',
    badgeText: 'text-gray-600 dark:text-gray-300',
  },
  {
    key: 'in_progress',
    label: 'In Progress',
    statuses: ['in_progress'],
    headerColor: 'text-blue-700 dark:text-blue-400',
    borderColor: 'border-l-blue-500',
    badgeBg: 'bg-blue-100 dark:bg-blue-900/40',
    badgeText: 'text-blue-700 dark:text-blue-300',
  },
  {
    key: 'review',
    label: 'Review',
    statuses: ['review', 'qa', 'qa_failed', 'pr_submitted'],
    headerColor: 'text-yellow-700 dark:text-yellow-400',
    borderColor: 'border-l-yellow-500',
    badgeBg: 'bg-yellow-100 dark:bg-yellow-900/40',
    badgeText: 'text-yellow-700 dark:text-yellow-300',
  },
  {
    key: 'merged',
    label: 'Merged',
    statuses: ['merged', 'done'],
    headerColor: 'text-green-700 dark:text-green-400',
    borderColor: 'border-l-green-500',
    badgeBg: 'bg-green-100 dark:bg-green-900/40',
    badgeText: 'text-green-700 dark:text-green-300',
  },
];

const statusBadgeConfig: Record<string, { label: string; bg: string; text: string }> = {
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

interface KanbanBoardProps {
  stories: Story[];
}

export function KanbanBoard({ stories }: KanbanBoardProps) {
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);

  if (stories.length === 0) {
    return (
      <section className="card rounded-lg border border-gray-200 dark:border-gray-800 p-8 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">No stories yet.</p>
      </section>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {columns.map(col => {
          const colStories = stories.filter(s => col.statuses.includes(s.status));
          return (
            <div key={col.key} className="flex flex-col min-h-0">
              {/* Column header */}
              <div className="flex items-center gap-2 mb-3 px-1">
                <h3 className={`text-sm font-semibold ${col.headerColor}`}>{col.label}</h3>
                <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-medium ${col.badgeBg} ${col.badgeText}`}>
                  {colStories.length}
                </span>
              </div>

              {/* Cards container */}
              <div className="flex-1 space-y-2.5 column-bg rounded-lg p-2.5 min-h-[120px]">
                {colStories.length === 0 && (
                  <div className="flex items-center justify-center h-full min-h-[80px]">
                    <p className="text-xs text-gray-300 dark:text-gray-600">No stories</p>
                  </div>
                )}
                {colStories.map(story => {
                  const badge = statusBadgeConfig[story.status] ?? { label: story.status, bg: 'bg-gray-100 dark:bg-gray-700/50', text: 'text-gray-600 dark:text-gray-300' };
                  return (
                    <button
                      key={story.id}
                      type="button"
                      onClick={() => setSelectedStory(story)}
                      className={`w-full text-left card rounded-lg border border-gray-200 dark:border-gray-700 border-l-[3px] ${col.borderColor} p-3 shadow-sm hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-150 cursor-pointer group`}
                    >
                      {/* Story ID + badge */}
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-mono text-gray-400 dark:text-gray-500 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors truncate max-w-[60%]">
                          {story.id}
                        </span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.bg} ${badge.text}`}>
                          {badge.label}
                        </span>
                      </div>

                      {/* Title */}
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 leading-snug mb-2 line-clamp-2">
                        {story.title}
                      </p>

                      {/* Footer: points + assignee */}
                      <div className="flex items-center justify-between">
                        {story.points != null ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            {story.points} pts
                          </span>
                        ) : (
                          <span />
                        )}
                        {(story.assignee || story.assignedAgentId) ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500 truncate max-w-[50%]">
                            <span className="w-4 h-4 rounded-full bg-hive-100 dark:bg-hive-900/50 text-hive-700 dark:text-hive-300 flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                              {(story.assignee || story.assignedAgentId || '?').charAt(0).toUpperCase()}
                            </span>
                            <span className="truncate">{story.assignee || story.assignedAgentId}</span>
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {selectedStory && (
        <StoryDetailModal
          story={selectedStory}
          onClose={() => setSelectedStory(null)}
        />
      )}
    </>
  );
}
