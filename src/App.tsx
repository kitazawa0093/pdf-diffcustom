import { useState } from "react";
import { DiffWorkspace } from "./DiffWorkspace";
import { SessionHome } from "./SessionHome";
import "./App.css";

type AppRoute =
  | { kind: "home" }
  | { kind: "workspace"; sessionId: string };

export default function App() {
  const [route, setRoute] = useState<AppRoute>({ kind: "home" });

  if (route.kind === "home") {
    return (
      <SessionHome
        onOpen={(sessionId) => setRoute({ kind: "workspace", sessionId })}
        onNew={(sessionId) => setRoute({ kind: "workspace", sessionId })}
      />
    );
  }

  return (
    <DiffWorkspace
      key={route.sessionId}
      sessionId={route.sessionId}
      onBack={() => setRoute({ kind: "home" })}
    />
  );
}
