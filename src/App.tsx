import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/context/ThemeContext";
import { ModeProvider } from "@/context/ModeContext";
import Layout from "@/components/Layout";
import HomePage from "@/pages/HomePage";
import SkillsPage from "@/pages/SkillsPage";
import RunPage from "@/pages/RunPage";
import DigestPage from "@/pages/DigestPage";
import StatsPage from "@/pages/StatsPage";

export default function App() {
  return (
    <ThemeProvider>
      <ModeProvider>
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/run/:skillId" element={<RunPage />} />
              <Route path="/d/:slug" element={<DigestPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="*" element={<HomePage />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </ModeProvider>
    </ThemeProvider>
  );
}
