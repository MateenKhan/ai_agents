import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import TasksPage from './pages/TasksPage';
import { ProjectProvider } from './pages/tasks/projectContext';
import { ToastProvider } from './pages/tasks/components/Toast';
import { ConfirmProvider } from './pages/tasks/components/ConfirmProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
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
  </React.StrictMode>,
);
