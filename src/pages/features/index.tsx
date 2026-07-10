/**
 * Route entry for /features.
 *
 * The CSS import lives HERE, not in FeaturesPage, so that scripts/build-landing.tsx can
 * import the component under plain Node — which cannot parse a `.css` import — and inline
 * the same stylesheet itself. One component, one stylesheet, two renderers.
 *
 * `inApp` is the only thing that differs between them: it reveals the links back to the
 * board, which would 404 on the marketing site.
 */
import React from 'react';
import './features.css';
import FeaturesPage from './FeaturesPage';

export default function FeaturesRoute() {
  return <FeaturesPage inApp />;
}
