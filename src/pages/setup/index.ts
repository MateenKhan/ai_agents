// First-run setup: the full-screen starting flow (StartScreen) and the gate that decides
// when it shows (useSetupGate). TasksPage consumes both through this barrel.
export { StartScreen, INIT_REPO_UNSUPPORTED } from './StartScreen';
export { useSetupGate, SETUP_DONE_KEY } from './useSetupGate';
