import { useState } from "react";
import { useNavigate } from "react-router-dom";

const MODEL_OPTIONS = ["Claude Opus 4.6", "Claude Sonnet 4.6", "Claude Haiku 4.5"];
const SIZE_TIERS = [
  { value: "small", label: "Small (2 vCPU, 8GB)" },
  { value: "medium", label: "Medium (4 vCPU, 16GB)" },
  { value: "large", label: "Large (8 vCPU, 32GB)" },
];

export function SubmitRun() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [repositories, setRepositories] = useState<string[]>([""]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [model, setModel] = useState(MODEL_OPTIONS[0]!);
  const [sizeTier, setSizeTier] = useState("medium");
  const [submitting, setSubmitting] = useState(false);

  const addRepository = () => setRepositories([...repositories, ""]);

  const removeRepository = (index: number) => {
    setRepositories(repositories.filter((_, i) => i !== index));
  };

  const updateRepository = (index: number, value: string) => {
    const updated = [...repositories];
    updated[index] = value;
    setRepositories(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          repositories: repositories.filter(Boolean),
          model,
          sizeTier,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { id: string };
        navigate(`/run/${data.id}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">New Run</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
            Requirement Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-hive-500 focus:border-transparent"
            placeholder="Add user authentication with OAuth2"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-hive-500 focus:border-transparent"
            placeholder="Describe the requirements in detail..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Repositories
          </label>
          <div className="space-y-2">
            {repositories.map((repo, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="url"
                  value={repo}
                  onChange={(e) => updateRepository(index, e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-hive-500 focus:border-transparent"
                  placeholder="https://github.com/org/repo"
                />
                {repositories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRepository(index)}
                    className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-md"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addRepository}
            className="mt-2 text-sm text-hive-600 hover:text-hive-700 font-medium"
          >
            + Add repository
          </button>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-gray-600 hover:text-gray-900 font-medium"
          >
            {showAdvanced ? "Hide" : "Show"} Advanced Options
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-4 p-4 bg-gray-50 rounded-md">
              <div>
                <label htmlFor="model" className="block text-sm font-medium text-gray-700 mb-1">
                  Model
                </label>
                <select
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-hive-500"
                >
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="size" className="block text-sm font-medium text-gray-700 mb-1">
                  Size Tier
                </label>
                <select
                  id="size"
                  value={sizeTier}
                  onChange={(e) => setSizeTier(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-hive-500"
                >
                  {SIZE_TIERS.map((tier) => (
                    <option key={tier.value} value={tier.value}>
                      {tier.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || !title}
          className="w-full px-4 py-2 bg-hive-600 text-white rounded-md hover:bg-hive-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {submitting ? "Submitting..." : "Submit Run"}
        </button>
      </form>
    </div>
  );
}
