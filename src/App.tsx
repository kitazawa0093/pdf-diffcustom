import { useState } from "react";
import { DiffWorkspace } from "./DiffWorkspace";
import { SessionHome, type OpenWorkspaceOptions } from "./SessionHome";
import "./App.css";

type AppRoute =
  | { kind: "home" }
  | { kind: "workspace"; sessionId: string } & OpenWorkspaceOptions;

export default function App() {
  const [route, setRoute] = useState<AppRoute>({ kind: "home" });

  if (route.kind === "home") {
    return (
      <SessionHome
        onOpen={(sessionId, options) =>
          setRoute({ kind: "workspace", sessionId, ...options })
        }
        onNew={(sessionId) => setRoute({ kind: "workspace", sessionId })}
      />
    );
  }

  return (
    <DiffWorkspace
      key={`${route.sessionId}-${route.nameSearch ?? ""}-${route.navIndex ?? ""}`}
      sessionId={route.sessionId}
      initialNameSearch={route.nameSearch}
      initialNavIndex={route.navIndex}
      onBack={() => setRoute({ kind: "home" })}
    />
  );
}
