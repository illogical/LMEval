import { createContext, useContext, useState } from 'react';

interface EvalHeaderActionContextValue {
  headerAction: React.ReactNode;
  setHeaderAction: (node: React.ReactNode) => void;
}

const EvalHeaderActionContext = createContext<EvalHeaderActionContextValue>({
  headerAction: null,
  setHeaderAction: () => {},
});

export function EvalHeaderActionProvider({ children }: { children: React.ReactNode }) {
  const [headerAction, setHeaderAction] = useState<React.ReactNode>(null);
  return (
    <EvalHeaderActionContext.Provider value={{ headerAction, setHeaderAction }}>
      {children}
    </EvalHeaderActionContext.Provider>
  );
}

export function useEvalHeaderAction() {
  return useContext(EvalHeaderActionContext);
}
