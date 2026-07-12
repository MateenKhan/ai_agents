import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import TasksPage from './pages/TasksPage';
import WorkflowPage from './pages/WorkflowPage';
import CanvasPage from './pages/canvas/CanvasPage';
import IDEPage from './pages/ide';
import { ProjectProvider } from './pages/tasks/projectContext';
import { ToastProvider } from './pages/tasks/components/Toast';
import { ConfirmProvider } from './pages/tasks/components/ConfirmProvider';
import './index.css';

// Lazy: the landing page carries its own dark stylesheet and is visited once, if ever. No
// reason for it to sit in the bundle a returning user downloads to look at their board.
const FeaturesPage = lazy(() => import('./pages/features'));

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* The `prefers-reduced-motion` block in index.css zeroes CSS animation/transition
        durations. It CANNOT touch Framer Motion: those 18 <motion.*> components animate
        inline transforms from JS on rAF, which no media query can see. Without this,
        every toast spring, slide-over and layout animation played at full motion for a
        user who explicitly asked for none â€” while the CSS comment claimed otherwise.

        `reducedMotion="user"` reads the same OS setting and makes Framer skip transform
        and layout animation, keeping opacity fades (which don't trigger vestibular
        symptoms). It must sit ABOVE ToastProvider: toasts are the app's loudest motion. */}
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <ConfirmProvider>
          <ProjectProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Navigate to="/tasks" replace />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/tasks/:tab" element={<TasksPage />} />
                <Route path="/ide" element={<IDEPage />} />
                <Route path="/canvas" element={<CanvasPage />} />
                {/* Preview: the editor renders and saves to localStorage, but the engine still
                    runs its built-in pipeline. Wiring it up needs the /workflow endpoint. */}
                <Route path="/workflow" element={<WorkflowPage />} />
                {/* The landing page. Same component GitHub Pages gets, prerendered â€” see
                    scripts/build-landing.tsx. */}
                <Route path="/features" element={<Suspense fallback={null}><FeaturesPage /></Suspense>} />
                <Route path="*" element={<Navigate to="/tasks" replace />} />
              </Routes>
            </BrowserRouter>
          </ProjectProvider>
        </ConfirmProvider>
      </ToastProvider>
    </MotionConfig>
  </React.StrictMode>,
);

