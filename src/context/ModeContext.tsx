import { createContext, useContext, useState, type ReactNode } from "react";
import type { WriterMode } from "@/lib/types";

interface ModeContextValue {
  mode: WriterMode;
  setMode: (m: WriterMode) => void;
}

const ModeContext = createContext<ModeContextValue>({ mode: "live", setMode: () => {} });

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<WriterMode>("live");
  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}

export const useMode = () => useContext(ModeContext);
