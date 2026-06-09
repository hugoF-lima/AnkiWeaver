
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import App from "./app/App.tsx";
import i18n from "./app/i18n";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <I18nextProvider i18n={i18n}>
    <App />
  </I18nextProvider>
);
  
