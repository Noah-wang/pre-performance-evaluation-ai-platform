import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installErrorReporter } from "./lib/errorReporter";

installErrorReporter();

createRoot(document.getElementById("root")!).render(<App />);
