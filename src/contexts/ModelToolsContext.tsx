import React, { createContext, useContext, useState } from 'react';
import { CompositeModelTools, createCompositeModelTools } from '../services/tools';

interface ModelToolsContextType {
    modelTools: CompositeModelTools;
}

const ModelToolsContext = createContext<ModelToolsContextType | undefined>(undefined);

export const ModelToolsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [modelTools] = useState(() => createCompositeModelTools());

    return (
        <ModelToolsContext.Provider value={{ modelTools }}>
            {children}
        </ModelToolsContext.Provider>
    );
};

export const useModelTools = () => {
    const context = useContext(ModelToolsContext);
    if (!context) {
        throw new Error('useModelTools must be used within a ModelToolsProvider');
    }
    return context.modelTools;
}; 