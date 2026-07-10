import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import TasksPage from './pages/TasksPage';
import { ProjectProvider } from './pages/tasks/projectContext';
import { ToastProvider } from './pages/tasks/components/Toast';
import { ConfirmProvider } from './pages/tasks/components/ConfirmProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* The `prefers-reduced-motion` block in index.css zeroes CSS animation/transition
        durations. It CANNOT touch Framer Motion: those 18 <motion.*> components animate
        inline transforms from JS on rAF, which no media query can see. Without this,
        every toast spring, slide-over and layout animation played at full motion for a
        user who explicitly asked for none — while the CSS comment claimed otherwise.

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
                <Route path="*" element={<Navigate to="/tasks" replace />} />
              </Routes>
            </BrowserRouter>
          </ProjectProvider>
        </ConfirmProvider>
      </ToastProvider>
    </MotionConfig>
  </React.StrictMode>,
);
