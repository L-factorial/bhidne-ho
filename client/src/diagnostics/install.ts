import {AppState, Platform} from 'react-native';
import {diagnostic} from './events';
let installed = false;
export function installDiagnostics() {
  if (installed) return;
  installed = true;
  diagnostic('app.started');
  AppState.addEventListener('change', state => diagnostic('app.state', {state}));
  if (Platform.OS === 'web') {
    globalThis.addEventListener('error', () => diagnostic('app.unhandled_error', {}, 'error'));
    globalThis.addEventListener('unhandledrejection', () => diagnostic('app.unhandled_rejection', {}, 'error'));
  } else {
    // Preserve React Native's existing fatal-error behavior and reporting handler.
    const errorUtils = (globalThis as typeof globalThis & {ErrorUtils?: {
      getGlobalHandler(): (error: Error, fatal?: boolean) => void;
      setGlobalHandler(handler: (error: Error, fatal?: boolean) => void): void;
    }}).ErrorUtils;
    if (errorUtils) {
      const previous = errorUtils.getGlobalHandler();
      errorUtils.setGlobalHandler((error, fatal) => {
        diagnostic('app.unhandled_error', {fatal: !!fatal}, 'error');
        previous(error, fatal);
      });
    }
  }
}
