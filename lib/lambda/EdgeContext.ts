import type { Shibboleth } from '../../context/IContext';

/** Minimal, non-secret subset of IContext the edge lambdas need at runtime. */
export interface EdgeContext {
  APP_LOGIN_HEADER: string;
  APP_LOGOUT_HEADER: string;
  appAuthorization: boolean;
  SHIBBOLETH: Shibboleth;
}

// Written next to the bundle by the construct at synth time (see lib/EdgeContext.ts);
// never bundled itself - require(), not import, so tsc doesn't try to resolve this file.
export const edgeContext: EdgeContext = require('./edge-context.json');
