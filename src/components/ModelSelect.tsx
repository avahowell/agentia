import { useState } from 'react';

const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';

interface ModelSelectProps {
  onModelChange?: (model: string) => void;
}

export function ModelSelect({ onModelChange }: ModelSelectProps) {
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setSelectedModel(newModel);
    onModelChange?.(newModel);
  };

  return (
    <select 
      value={selectedModel}
      onChange={handleChange}
      className="model-select"
      title="Select AI model"
    >
      <option value={DEFAULT_MODEL}>Sonnet</option>
    </select>
  );
} 