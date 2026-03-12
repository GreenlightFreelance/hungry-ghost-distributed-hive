import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';

interface Repo {
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  owner: { login: string; avatar_url: string };
}

interface Props {
  selected: string[];
  onSelect: (repos: string[]) => void;
}

export function RepoSearch({ selected, onSelect }: Props) {
  const token = useAuthStore(state => state.token);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const search = useCallback(
    async (q: string) => {
      if (!token || q.length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        // Search across all repos the user has access to (personal + orgs)
        const res = await fetch(
          `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}+in:name&sort=updated&per_page=20`,
          {
            headers: {
              Accept: 'application/vnd.github+json',
              Authorization: `Bearer ${token}`,
            },
          },
        );
        if (res.ok) {
          const data = (await res.json()) as { items: Repo[] };
          setResults(data.items);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  const handleInput = (value: string) => {
    setQuery(value);
    setShowDropdown(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  };

  const toggleRepo = (repo: Repo) => {
    const url = repo.html_url;
    if (selected.includes(url)) {
      onSelect(selected.filter(r => r !== url));
    } else {
      onSelect([...selected, url]);
    }
    setQuery('');
    setShowDropdown(false);
  };

  const removeRepo = (url: string) => {
    onSelect(selected.filter(r => r !== url));
  };

  return (
    <div ref={wrapperRef}>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Repositories</label>

      {/* Selected repos */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selected.map(url => {
            const name = url.replace('https://github.com/', '');
            return (
              <span
                key={url}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-hive-50 dark:bg-hive-900/30 text-hive-700 dark:text-hive-300 rounded-full text-sm border border-hive-200 dark:border-hive-700"
              >
                {name}
                <button
                  type="button"
                  onClick={() => removeRepo(url)}
                  className="text-hive-400 dark:text-hive-500 hover:text-hive-700 dark:hover:text-hive-300 ml-0.5"
                >
                  x
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => query.length >= 2 && setShowDropdown(true)}
          className="w-full px-3 py-2 card border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-hive-500 focus:border-transparent transition-colors"
          placeholder="Search repositories..."
        />

        {/* Dropdown */}
        {showDropdown && (query.length >= 2 || results.length > 0) && (
          <div className="absolute z-10 w-full mt-1 card border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg dark:shadow-black/30 max-h-64 overflow-y-auto">
            {loading && (
              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Searching...</div>
            )}
            {!loading && results.length === 0 && query.length >= 2 && (
              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No repositories found</div>
            )}
            {results.map(repo => {
              const isSelected = selected.includes(repo.html_url);
              return (
                <button
                  key={repo.full_name}
                  type="button"
                  onClick={() => toggleRepo(repo)}
                  className={`w-full text-left px-3 py-2 hover-card flex items-center gap-3 transition-colors ${
                    isSelected ? 'bg-hive-50 dark:bg-hive-900/20' : ''
                  }`}
                >
                  <img
                    src={repo.owner.avatar_url}
                    alt=""
                    className="w-5 h-5 rounded-full"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {repo.full_name}
                      {repo.private && (
                        <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500 font-normal">private</span>
                      )}
                    </div>
                    {repo.description && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{repo.description}</div>
                    )}
                  </div>
                  {isSelected && (
                    <span className="text-hive-600 dark:text-hive-400 text-sm">&#10003;</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
